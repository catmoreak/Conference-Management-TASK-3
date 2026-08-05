<#
Cuts a [StartSeconds, EndSeconds) segment out of the raw testsrc clip, re-encoding
(not stream-copying) so the cut is frame-accurate. This stands in for what
conversion-worker would hand podium in production: a video file that is ALREADY
trimmed to VideoTrimInfo's bounds. Podium/COM never trims anything itself -- see
the trim-semantics decision in the PoC writeup. Because the source has the
original absolute time burned into the pixels, the trimmed output's visible
counter will start at ~StartSeconds and end at ~EndSeconds, which is what makes
the trim boundary checkable by eye in the run-poc.ps1 screenshots.
#>
param(
    [string]$SourcePath = "$PSScriptRoot\test_clip.mp4",
    [string]$OutPath = "$PSScriptRoot\test_clip_trimmed.mp4",
    [double]$StartSeconds = 5,
    [double]$EndSeconds = 15
)

function Resolve-Ffmpeg {
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $fallback = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*\*\bin\ffmpeg.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($fallback) { return $fallback.FullName }
    throw "ffmpeg not found on PATH or in the winget package cache."
}

$ffmpeg = Resolve-Ffmpeg
$duration = $EndSeconds - $StartSeconds
if ($duration -le 0) { throw "EndSeconds must be greater than StartSeconds." }
if (-not (Test-Path $SourcePath)) { throw "Source clip not found: $SourcePath" }

Write-Host "Trimming $SourcePath -> $OutPath  [${StartSeconds}s .. ${EndSeconds}s]" -ForegroundColor Cyan

& $ffmpeg -y -ss $StartSeconds -i $SourcePath -t $duration -c:v libx264 -c:a aac -pix_fmt yuv420p $OutPath
if ($LASTEXITCODE -ne 0) { throw "ffmpeg trim failed with exit code $LASTEXITCODE" }

Write-Host "Wrote $OutPath" -ForegroundColor Green
Get-Item $OutPath | Select-Object Name, @{n='SizeKB';e={[math]::Round($_.Length/1KB,1)}}
