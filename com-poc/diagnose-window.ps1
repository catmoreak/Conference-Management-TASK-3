<#
One-shot diagnostic: while a slideshow is running, enumerate ALL top-level
Windows OS windows owned by the POWERPNT.EXE process directly via EnumWindows,
instead of trusting the COM object model's own .HWND properties (which just
came back null for SlideShowWindow across a full run). Settles whether
PowerPoint has any real, visible window in this session at all.
#>
param(
    [string]$PptxPath = "$PSScriptRoot\test_deck.pptx"
)

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class WinEnum {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    public class WinInfo {
        public IntPtr Handle;
        public string Title;
        public string ClassName;
        public bool Visible;
    }

    public static List<WinInfo> WindowsForProcess(uint pid) {
        var results = new List<WinInfo>();
        EnumWindows((hWnd, lParam) => {
            uint windowPid;
            GetWindowThreadProcessId(hWnd, out windowPid);
            if (windowPid == pid) {
                var titleSb = new StringBuilder(256);
                GetWindowText(hWnd, titleSb, titleSb.Capacity);
                var classSb = new StringBuilder(256);
                GetClassName(hWnd, classSb, classSb.Capacity);
                results.Add(new WinInfo {
                    Handle = hWnd,
                    Title = titleSb.ToString(),
                    ClassName = classSb.ToString(),
                    Visible = IsWindowVisible(hWnd)
                });
            }
            return true;
        }, IntPtr.Zero);
        return results;
    }
}
"@

Get-Process POWERPNT -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 300

Write-Host "Launching PowerPoint..." -ForegroundColor Cyan
$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = -1

$pres = $null
try {
    $pres = $ppt.Presentations.Open($PptxPath, $false, $false, $true)
    Write-Host "App.HWND = [$($ppt.HWND)]" -ForegroundColor Cyan
    Write-Host "Presentation Windows.Count = $($pres.Windows.Count)" -ForegroundColor Cyan
    for ($i = 1; $i -le $pres.Windows.Count; $i++) {
        Write-Host "  Windows($i).HWND = [$($pres.Windows.Item($i).HWND)]" -ForegroundColor Cyan
    }

    Write-Host "Starting slideshow..." -ForegroundColor Cyan
    $pres.SlideShowSettings.Run() | Out-Null
    Start-Sleep -Seconds 2
    $ssw = $ppt.SlideShowWindows.Item(1)
    Write-Host "SlideShowWindows.Count = $($ppt.SlideShowWindows.Count)" -ForegroundColor Cyan
    Write-Host "SlideShowWindow.HWND (COM) = [$($ssw.HWND)]" -ForegroundColor Cyan

    $proc = Get-Process POWERPNT -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "POWERPNT PID = $($proc.Id), MainWindowHandle = [$($proc.MainWindowHandle)], MainWindowTitle = '$($proc.MainWindowTitle)'" -ForegroundColor Cyan
        $wins = [WinEnum]::WindowsForProcess([uint32]$proc.Id)
        Write-Host "EnumWindows found $($wins.Count) top-level window(s) owned by POWERPNT PID $($proc.Id):" -ForegroundColor Green
        foreach ($w in $wins) {
            Write-Host ("  hwnd=[{0}] visible={1} class='{2}' title='{3}'" -f $w.Handle, $w.Visible, $w.ClassName, $w.Title)
        }
    }
    else {
        Write-Host "POWERPNT process not found via Get-Process!" -ForegroundColor Red
    }

    Start-Sleep -Seconds 1
    try { $ssw.View.Exit() } catch {}
}
finally {
    try { if ($pres) { $pres.Close() } } catch {}
    try { $ppt.Quit() } catch {}
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt)
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
