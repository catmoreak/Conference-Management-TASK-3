<#
Opens test_deck.pptx, drives it via SlideShowWindow.View.GotoSlide (the same
primitive goto_slide/next_slide/prev_slide would call in the real module), and
screenshots the full screen at each checkpoint. This is the actual question the
whole PoC exists to answer: does the embedded, pre-trimmed video (a) autoplay
when arrived at via a direct GotoSlide jump -- not just a manual forward Next --
(b) show the correct trim window, and (c) keep correct timing.

Revision 3: SlideShowWindow.HWND (and Presentation.Windows(1).HWND) come back
null through late-bound PowerShell COM -- confirmed via diagnose-window.ps1,
which also confirmed PowerPoint DOES create real, visible windows in this
session (App.HWND resolves fine; EnumWindows finds a visible 'screenClass'
window titled "PowerPoint Slide Show - ..." once the slideshow is running).
So this version stops trusting SlideShowWindow.HWND entirely and instead finds
the actual OS window by enumerating top-level windows owned by the POWERPNT
process and preferring the 'screenClass' (slideshow) window, falling back to
'PPTFrameClass' (editor) -- resolved freshly at every checkpoint, since which
window is frontmost-eligible can change over the run -- then forces it to the
foreground before each screenshot.

There is still no reliable, verified COM property for reading live video
playback position out of a Shape during a slideshow, so this script does NOT
attempt to poll "is it playing" -- the burned-in HH:MM:SS overlay from
prepare-clip.ps1, read from the screenshots, is what makes timing/trim
checkable.
#>
param(
    [string]$PptxPath = "$PSScriptRoot\test_deck.pptx",
    [string]$ScreenshotDir = "$PSScriptRoot\screenshots",
    [double]$TrimStartSeconds = 5,
    [double]$TrimEndSeconds = 15
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PptWindow {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;

    // Clicks the center of the primary screen -- used to trigger PowerPoint's
    // default click-to-play behavior on a full-bleed video shape, since
    // AnimationSettings.PlaySettings.PlayOnEntry was empirically confirmed
    // (via three identical frozen-frame screenshots) not to trigger playback
    // when the slide is reached via GotoSlide.
    public static void ClickCenter(int screenWidth, int screenHeight) {
        int x = screenWidth / 2;
        int y = screenHeight / 2;
        SetCursorPos(x, y);
        mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, x, y, 0, 0);
    }

    public const int SW_RESTORE = 9;

    public class WinInfo {
        public IntPtr Handle;
        public string Title;
        public string ClassName;
    }

    public static List<WinInfo> VisibleWindowsForProcess(uint pid) {
        var results = new List<WinInfo>();
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            uint windowPid;
            GetWindowThreadProcessId(hWnd, out windowPid);
            if (windowPid == pid) {
                var titleSb = new StringBuilder(256);
                GetWindowText(hWnd, titleSb, titleSb.Capacity);
                var classSb = new StringBuilder(256);
                GetClassName(hWnd, classSb, classSb.Capacity);
                results.Add(new WinInfo { Handle = hWnd, Title = titleSb.ToString(), ClassName = classSb.ToString() });
            }
            return true;
        }, IntPtr.Zero);
        return results;
    }

    // Prefers the live slideshow surface ('screenClass') over the editor frame
    // ('PPTFrameClass'), falling back to any visible window for the process.
    public static WinInfo BestCandidate(uint pid) {
        var wins = VisibleWindowsForProcess(pid);
        foreach (var w in wins) { if (w.ClassName == "screenClass") return w; }
        foreach (var w in wins) { if (w.ClassName == "PPTFrameClass") return w; }
        if (wins.Count > 0) return wins[0];
        return null;
    }

    public static void Force(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return;
        ShowWindow(hWnd, SW_RESTORE);
        uint dummyPid;
        uint targetThread = GetWindowThreadProcessId(hWnd, out dummyPid);
        uint currentThread = GetCurrentThreadId();
        bool attached = false;
        if (targetThread != currentThread) {
            attached = AttachThreadInput(currentThread, targetThread, true);
        }
        SetForegroundWindow(hWnd);
        if (attached) {
            AttachThreadInput(currentThread, targetThread, false);
        }
    }

    public static string ForegroundTitle() {
        IntPtr h = GetForegroundWindow();
        var sb = new StringBuilder(256);
        GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }
}
"@

function Clear-ComObject($obj) {
    if ($obj) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj)
    }
}

function Save-Screenshot([string]$Path) {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

function Get-PowerPointProcess {
    return Get-Process POWERPNT -ErrorAction SilentlyContinue
}

function Send-PlayClick {
    $proc = Get-PowerPointProcess
    if (-not $proc) { return }
    $candidate = [PptWindow]::BestCandidate([uint32]$proc.Id)
    if ($candidate) {
        [PptWindow]::Force($candidate.Handle)
        Start-Sleep -Milliseconds 200
    }
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    [PptWindow]::ClickCenter($bounds.Width, $bounds.Height)
    Write-Host "  -> sent center click ($($bounds.Width/2),$($bounds.Height/2)) to trigger click-to-play" -ForegroundColor DarkCyan
}

if (-not (Test-Path $PptxPath)) {
    throw "Deck not found: $PptxPath (run setup-test-deck.ps1 first)"
}

# Kill any stray POWERPNT.EXE left over from a previous failed run so Presentations.Open
# doesn't collide with an already-open copy of the same file.
Get-PowerPointProcess | Stop-Process -Force
Start-Sleep -Milliseconds 300

New-Item -ItemType Directory -Force -Path $ScreenshotDir | Out-Null
$log = [System.Collections.Generic.List[object]]::new()

function Checkpoint([string]$Name, [string]$Expected, [double]$SettleSeconds = 0) {
    if ($SettleSeconds -gt 0) { Start-Sleep -Seconds $SettleSeconds }

    $proc = Get-PowerPointProcess
    $candidate = $null
    if ($proc) {
        $candidate = [PptWindow]::BestCandidate([uint32]$proc.Id)
        if ($candidate) {
            [PptWindow]::Force($candidate.Handle)
            Start-Sleep -Milliseconds 150
        }
    }

    $file = Join-Path $ScreenshotDir "$Name.png"
    Save-Screenshot $file
    $entry = [ordered]@{
        name            = $Name
        file            = $file
        expected        = $Expected
        takenAt         = (Get-Date).ToString("o")
        foregroundTitle = [PptWindow]::ForegroundTitle()
        targetClass     = if ($candidate) { $candidate.ClassName } else { $null }
        targetTitle     = if ($candidate) { $candidate.Title } else { $null }
        powerpointAlive = [bool]$proc
    }
    $log.Add($entry) | Out-Null
    Write-Host "[$Name] $Expected  (foreground='$($entry.foregroundTitle)', target=$($entry.targetClass), alive=$($entry.powerpointAlive))" -ForegroundColor Yellow
}

Write-Host "Launching PowerPoint..." -ForegroundColor Cyan
$ppt = New-Object -ComObject PowerPoint.Application
# Application.Visible is MsoTriState, not bool -- -1 is msoTrue (see setup-test-deck.ps1).
$ppt.Visible = -1

$pres = $null
$ssw = $null
$runError = $null
try {
    try {
        # Open(FileName, ReadOnly, Untitled, WithWindow)
        $pres = $ppt.Presentations.Open($PptxPath, $false, $false, $true)

        Write-Host "Starting slideshow..." -ForegroundColor Cyan
        $pres.SlideShowSettings.Run() | Out-Null
        Start-Sleep -Milliseconds 500
        $ssw = $ppt.SlideShowWindows.Item(1)

        Checkpoint "00_start_slide1" "Slide 1 title text, no video visible" 1

        Write-Host "Direct GotoSlide(2) -- simulating goto_slide straight to the video slide" -ForegroundColor Cyan
        $ssw.View.GotoSlide(2)
        Start-Sleep -Milliseconds 300
        Send-PlayClick
        Checkpoint "01_goto2_t0" "Just arrived at slide 2, clicked to trigger play -- checking startup latency / does it autoplay at all" 0
        Checkpoint "02_goto2_t2s" "~2s after arrival -- expect on-screen counter near 00:00:0$([int]($TrimStartSeconds+2))" 2
        Checkpoint "03_goto2_t5s" "~5s after arrival -- expect on-screen counter near 00:00:$([int]($TrimStartSeconds+5))" 3
        Checkpoint "04_goto2_near_trim_end" "~9s after arrival -- expect on-screen counter near 00:00:$([int]($TrimEndSeconds-1)), just before trim end" 4

        Checkpoint "05_after_clip_should_end" "~2s past trim end -- did it hold last frame, loop, or auto-advance?" 2

        Write-Host "GotoSlide(3) -- forward advance past the video" -ForegroundColor Cyan
        $ssw.View.GotoSlide(3)
        Checkpoint "06_slide3" "Slide 3 title text" 1

        Write-Host "GotoSlide(1) -- jump backward past the video slide" -ForegroundColor Cyan
        $ssw.View.GotoSlide(1)
        Checkpoint "07_back_to_slide1" "Slide 1 title text again" 1

        Write-Host "GotoSlide(2) again -- re-entry test, does the trim/autoplay repeat identically?" -ForegroundColor Cyan
        $ssw.View.GotoSlide(2)
        Start-Sleep -Milliseconds 300
        Send-PlayClick
        Checkpoint "08_second_entry_t0" "Re-arrival at slide 2, clicked to trigger play" 0
        Checkpoint "09_second_entry_t2s" "~2s after re-arrival -- should again read near 00:00:0$([int]($TrimStartSeconds+2)), not continuing from where it left off last time" 2

        $ssw.View.Exit()
    }
    catch {
        $runError = $_.Exception.Message
        Write-Host "RUN ERROR: $runError" -ForegroundColor Red
        $log.Add([ordered]@{
            name            = "ERROR"
            error           = $runError
            takenAt         = (Get-Date).ToString("o")
            powerpointAlive = [bool](Get-PowerPointProcess)
        }) | Out-Null
    }
}
finally {
    try { if ($pres) { $pres.Close() } } catch {}
    try { $ppt.Quit() } catch {}
    Clear-ComObject $ssw
    Clear-ComObject $pres
    Clear-ComObject $ppt
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}

$logPath = Join-Path $ScreenshotDir "run-log.json"
$log | ConvertTo-Json -Depth 4 | Set-Content -Path $logPath -Encoding utf8
Write-Host "Wrote $logPath" -ForegroundColor Green
Write-Host "Screenshots in $ScreenshotDir" -ForegroundColor Green
if ($runError) {
    Write-Host "Run ended with an error: $runError" -ForegroundColor Red
}
