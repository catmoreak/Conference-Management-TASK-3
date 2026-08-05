<#
Parameterized generalization of com-poc/setup-test-deck.ps1: builds a
throwaway .pptx with a given number of plain-text slides, embedding the
(already-trimmed) test clip full-bleed on whichever slide numbers are passed
in -VideoSlideNumbers. Used to generate the sample-deck matrix for
run-tests.mjs.
#>
param(
    [Parameter(Mandatory = $true)][string]$OutputPptx,
    [Parameter(Mandatory = $true)][int]$SlideCount,
    [int[]]$VideoSlideNumbers = @(),
    [string]$VideoPath = "$PSScriptRoot\..\..\..\..\com-poc\test_clip_trimmed.mp4"
)

$ppLayoutTitle = 1
$ppLayoutBlank = 12
$ppSaveAsOpenXMLPresentation = 24

function Clear-ComObject($obj) {
    if ($obj) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj) }
}

if ($VideoSlideNumbers.Count -gt 0 -and -not (Test-Path $VideoPath)) {
    throw "Video not found: $VideoPath"
}
if (Test-Path $OutputPptx) {
    Remove-Item $OutputPptx -Force
}

Write-Host "Building $OutputPptx ($SlideCount slides, video on: $($VideoSlideNumbers -join ','))..." -ForegroundColor Cyan
$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = -1

$pres = $null
try {
    $pres = $ppt.Presentations.Add()
    $videoSet = @{}
    foreach ($n in $VideoSlideNumbers) { $videoSet[$n] = $true }

    for ($i = 1; $i -le $SlideCount; $i++) {
        if ($videoSet.ContainsKey($i)) {
            $slide = $pres.Slides.Add($i, $ppLayoutBlank)
            $slideWidth = $pres.PageSetup.SlideWidth
            $slideHeight = $pres.PageSetup.SlideHeight
            $shape = $slide.Shapes.AddMediaObject2($VideoPath, $false, $true, 0, 0, $slideWidth, $slideHeight)
            $shape.AnimationSettings.PlaySettings.PlayOnEntry = $true
            $shape.AnimationSettings.PlaySettings.HideWhileNotPlaying = $false
            $shape.AnimationSettings.PlaySettings.LoopUntilStopped = $false
        }
        else {
            $slide = $pres.Slides.Add($i, $ppLayoutTitle)
            $slide.Shapes.Title.TextFrame.TextRange.Text = "Slide $i"
        }
    }

    $pres.SaveAs($OutputPptx, $ppSaveAsOpenXMLPresentation)
    Write-Host "Wrote $OutputPptx" -ForegroundColor Green
}
finally {
    if ($pres) { $pres.Close() }
    $ppt.Quit()
    Clear-ComObject $pres
    Clear-ComObject $ppt
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
