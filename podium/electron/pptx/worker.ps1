<#
Long-lived PowerPoint COM automation worker, driven by pptxController.js over
stdio. One JSON command per line in, one JSON response per line out, matched
by "id". Emits {"type":"ready"} once PowerPoint COM connects at boot, or
{"type":"init_error",...} if that fails.

Design carried over from com-poc/ (see that folder's scripts for the
step-by-step validation this is based on):
  - SlideShowWindow.HWND (COM) is unreliable/null through late-bound
    PowerShell -- the real window is found by enumerating top-level windows
    owned by this process and preferring window class 'screenClass' (the live
    slideshow surface), falling back to 'PPTFrameClass' (the editor).
  - AnimationSettings.PlaySettings.PlayOnEntry does not reliably trigger
    autoplay when a slide is reached via GotoSlide (confirmed empirically:
    three identical frozen-frame screenshots in the PoC). Playback is
    triggered by simulating a real click on the video shape instead -- and
    only on slides listed in videoTrims, never blindly, since clicking a
    normal content slide could trigger an unintended animation/build advance.
  - Trim is assumed pre-baked into the media file upstream (conversion-worker)
    before this module ever sees it; videoTrims is used here only to know
    WHICH slides have a video to click, never to set trim points via COM.
#>

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PptWorkerWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);

    public const int SW_RESTORE = 9;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;

    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

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

    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, x, y, 0, 0);
    }
}
"@

function Write-Json($obj) {
    $json = $obj | ConvertTo-Json -Compress -Depth 6
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

function Get-PowerPointProcess {
    return Get-Process POWERPNT -ErrorAction SilentlyContinue
}

# RPC_S_SERVER_UNAVAILABLE / RPC_E_DISCONNECTED / RPC_S_CALL_FAILED -- the
# classic HRESULT signatures for "the COM server process died mid-call".
$script:CrashHResults = @(-2147023174, -2147417848, -2147023170)
function Test-CrashException($ex) {
    return ($ex -is [System.Runtime.InteropServices.COMException]) -and ($script:CrashHResults -contains $ex.HResult)
}

function Clear-ComObject($obj) {
    if ($obj) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj) }
}

$script:ppt = $null
$script:pres = $null
$script:ssw = $null
$script:videoSlideNumbers = @{}

function Connect-PowerPoint {
    $script:ppt = New-Object -ComObject PowerPoint.Application
    # Application.Visible is MsoTriState, not bool -- -1 is msoTrue.
    $script:ppt.Visible = -1
}

function Reset-PresentationState {
    # [void]-wrapped defensively: an uncaptured, non-void COM method call
    # inside a function becomes part of THAT function's return value in
    # PowerShell, silently corrupting whatever the caller assigns it to (see
    # the identical bug this fixed in Invoke-Nav via the Node smoke test).
    try { if ($script:ssw) { [void]$script:ssw.View.Exit() } } catch {}
    try { if ($script:pres) { [void]$script:pres.Close() } } catch {}
    Clear-ComObject $script:ssw
    Clear-ComObject $script:pres
    $script:ssw = $null
    $script:pres = $null
    $script:videoSlideNumbers = @{}
}

function Get-CurrentFacts {
    $currentSlide = $null
    $isPresenting = $false
    if ($script:ssw) {
        try {
            $currentSlide = [int]$script:ssw.View.Slide.SlideIndex
            $isPresenting = $true
        } catch {
            $isPresenting = $false
        }
    }
    $totalSlides = $null
    if ($script:pres) {
        try { $totalSlides = [int]$script:pres.Slides.Count } catch {}
    }
    return @{ currentSlide = $currentSlide; totalSlides = $totalSlides; isPresenting = $isPresenting }
}

# Duck-types the media shape rather than trusting a specific MsoShapeType/
# PpMediaType enum value -- accessing .MediaFormat throws on a non-media
# shape, which is a reliable enough signal without hardcoding a numeric
# constant this script has no way to verify against the installed Office
# version (see com-poc's writeup on the same tradeoff for animation effects).
function Find-MediaShape($slide) {
    foreach ($shape in $slide.Shapes) {
        try {
            $null = $shape.MediaFormat
            return $shape
        } catch {
            continue
        }
    }
    return $null
}

function Send-PlayClickIfVideoSlide([int]$slideNumber) {
    if (-not $script:videoSlideNumbers.ContainsKey($slideNumber)) { return }
    if (-not $script:ssw) { return }
    $proc = Get-PowerPointProcess
    if (-not $proc) { return }
    $candidate = [PptWorkerWin32]::BestCandidate([uint32]$proc.Id)
    if (-not $candidate) { return }

    [PptWorkerWin32]::Force($candidate.Handle)
    Start-Sleep -Milliseconds 200

    $rect = New-Object PptWorkerWin32+RECT
    [void][PptWorkerWin32]::GetWindowRect($candidate.Handle, [ref]$rect)
    $winW = $rect.Right - $rect.Left
    $winH = $rect.Bottom - $rect.Top

    $slide = $script:ssw.View.Slide
    $shape = Find-MediaShape $slide
    $slideW = $script:pres.PageSetup.SlideWidth
    $slideH = $script:pres.PageSetup.SlideHeight
    $scale = [Math]::Min($winW / $slideW, $winH / $slideH)
    $offsetX = ($winW - $slideW * $scale) / 2
    $offsetY = ($winH - $slideH * $scale) / 2

    if ($shape) {
        $targetX = $shape.Left + ($shape.Width / 2)
        $targetY = $shape.Top + ($shape.Height / 2)
    }
    else {
        # Slide was listed in videoTrims but no media shape was found on it --
        # fall back to the slide's visual center rather than silently skipping
        # the click.
        $targetX = $slideW / 2
        $targetY = $slideH / 2
    }

    $screenX = [int]($rect.Left + $offsetX + ($targetX * $scale))
    $screenY = [int]($rect.Top + $offsetY + ($targetY * $scale))
    [PptWorkerWin32]::Click($screenX, $screenY)
    Start-Sleep -Milliseconds 300

    # Detect + correct, rather than try to prevent: a click on an
    # already-played video's slide can land outside its active control
    # hotspot and fall through to PowerPoint's default "any click on the
    # slide advances the build sequence" behavior instead of restarting
    # playback. Confirmed via worker debug logging -- a subsequent command's
    # own fresh SlideIndex read came back one slide advanced even though the
    # PRECEDING command had already double-confirmed the correct slide before
    # this click fired, and no amount of blind waiting changed that (the
    # click's side effect isn't slow to land, it just sometimes IS an
    # advance). Since the intended slide number is already known here,
    # correcting with an explicit GotoSlide back is exact, not a guess.
    try {
        $afterClick = [int]$script:ssw.View.Slide.SlideIndex
        if ($afterClick -ne $slideNumber) {
            [Console]::Error.WriteLine("DEBUG click on slide $slideNumber landed on $afterClick -- correcting back")
            [void]$script:ssw.View.GotoSlide($slideNumber)
            Start-Sleep -Milliseconds 200
        }
    }
    catch {}
}

function Test-PowerPointComAlive {
    if (-not $script:ppt) { return $false }
    try {
        # .Visible alone is NOT a reliable enough liveness probe -- confirmed
        # empirically it can still return successfully on a stale/dead COM
        # reference (rather than throwing) while .Presentations on that same
        # dead reference silently returns $null instead of throwing. PowerShell
        # only throws on a METHOD call against $null ("cannot call a method on
        # a null-valued expression") -- a PROPERTY access against $null (like
        # .Presentations here, or .Count on the result) just silently
        # propagates $null with no exception at all, so exception-catching
        # alone doesn't detect this; the $null has to be checked explicitly.
        $presentations = $script:ppt.Presentations
        if ($null -eq $presentations) { return $false }
        return $true
    }
    catch {
        return $false
    }
}

function Invoke-LoadPresentation($req) {
    # A non-null $script:ppt only means we HELD a reference, not that the
    # process behind it is still alive -- if PowerPoint was killed externally
    # (crash, task manager, whatever), $script:ppt stays non-null while every
    # call through it throws. Checking for null alone would skip reconnecting
    # and hand Presentations.Open a dead COM reference, failing recovery with
    # a misleading com_call_failed instead of actually recovering.
    if (-not (Test-PowerPointComAlive)) {
        Clear-ComObject $script:ppt
        Clear-ComObject $script:pres
        Clear-ComObject $script:ssw
        $script:ppt = $null
        $script:pres = $null
        $script:ssw = $null
        try { Connect-PowerPoint }
        catch { return @{ ok = $false; code = 'com_connection_failed'; message = $_.Exception.Message } }
    }

    # Always tear down any previously loaded presentation/slideshow first --
    # covers both "a different session is loading" and "the same session is
    # being reloaded", and "slideshow already running" from the original spec.
    Reset-PresentationState

    if (-not (Test-Path -LiteralPath $req.fileUrl)) {
        return @{ ok = $false; code = 'file_not_found'; message = "File not found: $($req.fileUrl)" }
    }

    try {
        # Open(FileName, ReadOnly, Untitled, WithWindow)
        $script:pres = $script:ppt.Presentations.Open($req.fileUrl, $false, $false, $true)
    }
    catch {
        # Covers malformed/corrupt files too: Open throws, the file exists so
        # it isn't file_not_found, and this is the closest fit in the fixed
        # error-code enum.
        return @{ ok = $false; code = 'com_call_failed'; message = "Failed to open presentation: $($_.Exception.Message)" }
    }

    $script:videoSlideNumbers = @{}
    foreach ($trim in $req.videoTrims) {
        $script:videoSlideNumbers[[int]$trim.slideNumber] = $true
    }

    $facts = Get-CurrentFacts
    return @{ ok = $true; currentSlide = $facts.currentSlide; totalSlides = $facts.totalSlides }
}

function Invoke-Play($req) {
    if (-not $script:pres) {
        return @{ ok = $false; code = 'com_call_failed'; message = 'No presentation loaded; call load_presentation first.' }
    }
    try {
        $script:pres.SlideShowSettings.Run() | Out-Null
        Start-Sleep -Milliseconds 500
        $script:ssw = $script:ppt.SlideShowWindows.Item(1)
    }
    catch {
        return @{ ok = $false; code = 'com_call_failed'; message = "Failed to start slideshow: $($_.Exception.Message)" }
    }
    $facts = Get-CurrentFacts
    if ($facts.currentSlide) { Send-PlayClickIfVideoSlide $facts.currentSlide }
    return @{ ok = $true; currentSlide = $facts.currentSlide; totalSlides = $facts.totalSlides }
}

# View.Next()/View.Previous() are documented to step through the CURRENT
# slide's animation build sequence before actually changing slides -- the
# same call PowerPoint issues on a right-arrow/spacebar press during a live
# show. Our simulated click starts the video's playback but does not consume
# whatever build-step Next() is tracking, so a single Next() call can leave
# SlideIndex unchanged (confirmed empirically via the Node smoke test: this
# reproduced identically whether called immediately or 11s after the clip
# finished, ruling out "still playing" as the cause). So Next()/Previous() are
# retried until the slide index actually changes, bounded to avoid looping
# forever if a slide is genuinely the first/last one.
function Wait-ForSlideIndexSettle {
    $previous = $null
    for ($i = 0; $i -lt 5; $i++) {
        try { $current = [int]$script:ssw.View.Slide.SlideIndex } catch { return $null }
        if ($null -ne $previous -and $current -eq $previous) { return $current }
        $previous = $current
        Start-Sleep -Milliseconds 100
    }
    return $previous
}

function Invoke-Nav($req) {
    if (-not $script:ssw) {
        return @{ ok = $false; code = 'com_call_failed'; message = 'Slideshow is not running; call play first.' }
    }

    $beforeSlide = $null
    try { $beforeSlide = [int]$script:ssw.View.Slide.SlideIndex } catch {}

    try {
        if ($req.command -eq 'goto_slide') {
            [void]$script:ssw.View.GotoSlide([int]$req.slideNumber)
        }
        else {
            # Generous headroom: a slide just re-visited via Send-PlayClickIfVideoSlide
            # can have a freshly re-queued build step on top of whatever's needed to
            # actually leave it, observed empirically needing more than 5 attempts
            # when prev_slide is called twice back-to-back with no settle time between.
            $maxAttempts = 12
            for ($attempt = 0; $attempt -lt $maxAttempts; $attempt++) {
                if ($req.command -eq 'next_slide') { [void]$script:ssw.View.Next() } else { [void]$script:ssw.View.Previous() }
                $settled = Wait-ForSlideIndexSettle
                if ($null -eq $beforeSlide -or $settled -ne $beforeSlide) { break }
                # SlideIndex didn't move -- that call only consumed a pending
                # build step (or we're genuinely at the first/last slide, in
                # which case the next attempt will settle on the same value
                # again and we fall through after maxAttempts).
            }
        }
    }
    catch {
        return @{ ok = $false; code = 'com_call_failed'; message = "Navigation failed: $($_.Exception.Message)" }
    }
    # Only goto_slide reaches here without having already settled above.
    [void](Wait-ForSlideIndexSettle)
    # Read the slide actually landed on back from COM rather than trusting
    # the requested slideNumber, per the original spec's requirement.
    $facts = Get-CurrentFacts
    if ($facts.currentSlide) { Send-PlayClickIfVideoSlide $facts.currentSlide }
    return @{ ok = $true; currentSlide = $facts.currentSlide; totalSlides = $facts.totalSlides }
}

function Invoke-ExitSlideshow($req) {
    try { if ($script:ssw) { $script:ssw.View.Exit() } } catch {}
    Clear-ComObject $script:ssw
    $script:ssw = $null
    $facts = Get-CurrentFacts
    return @{ ok = $true; currentSlide = $facts.currentSlide; totalSlides = $facts.totalSlides }
}

function Invoke-GetStatus($req) {
    $facts = Get-CurrentFacts
    return @{
        ok              = $true
        currentSlide    = $facts.currentSlide
        totalSlides     = $facts.totalSlides
        isPresenting    = $facts.isPresenting
        powerpointAlive = [bool](Get-PowerPointProcess)
    }
}

try {
    Connect-PowerPoint
    Write-Json @{ type = 'ready' }
}
catch {
    Write-Json @{ type = 'init_error'; code = 'com_connection_failed'; message = $_.Exception.Message }
    exit 1
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ([string]::IsNullOrWhiteSpace($line)) { continue }

    try {
        $req = $line | ConvertFrom-Json
    }
    catch {
        continue
    }

    try {
        switch ($req.command) {
            'load_presentation' { $result = Invoke-LoadPresentation $req }
            'play' { $result = Invoke-Play $req }
            'goto_slide' { $result = Invoke-Nav $req }
            'next_slide' { $result = Invoke-Nav $req }
            'prev_slide' { $result = Invoke-Nav $req }
            'exit_slideshow' { $result = Invoke-ExitSlideshow $req }
            'get_status' { $result = Invoke-GetStatus $req }
            default { $result = @{ ok = $false; code = 'unknown'; message = "Unknown command: $($req.command)" } }
        }
    }
    catch {
        if (Test-CrashException $_.Exception) {
            # Drop every COM reference so the next load_presentation starts
            # clean instead of holding handles to a dead process.
            Clear-ComObject $script:ssw
            Clear-ComObject $script:pres
            Clear-ComObject $script:ppt
            $script:ssw = $null; $script:pres = $null; $script:ppt = $null
            $result = @{ ok = $false; code = 'powerpoint_crashed'; message = $_.Exception.Message }
        }
        else {
            $result = @{ ok = $false; code = 'com_call_failed'; message = $_.Exception.Message }
        }
    }

    $result.id = $req.id
    Write-Json $result
}
