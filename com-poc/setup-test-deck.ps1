<#
Builds a throwaway .pptx via PowerPoint COM automation to use as PoC input:
  Slide 1 (title layout)  -- plain text, "before" the video
  Slide 2 (blank layout)  -- the trimmed clip embedded full-bleed, set to autoplay
  Slide 3 (title layout)  -- plain text, "after" the video

This mirrors the real system: podium receives an already-trimmed, embedded video
(see prepare-clip.ps1) and just needs to present it -- it never sets trim itself.

Known unknown this script does NOT resolve: whether AnimationSettings.PlaySettings
.PlayOnEntry is still honored by the installed PowerPoint version for autoplay
triggered via GotoSlide (as opposed to a manual forward Next). That's exactly
what run-poc.ps1's screenshots are for. If autoplay doesn't fire, the fallback is
an explicit TimeLine.MainSequence entrance effect -- not attempted here yet.
#>
param(
    [string]$VideoPath = "$PSScriptRoot\test_clip_trimmed.mp4",
    [string]$OutputPptx = "$PSScriptRoot\test_deck.pptx"
)

# PpSlideLayout / PpSaveAsFileType constants (late-bound COM has no enum access,
# so these are hardcoded from the documented enum values).
$ppLayoutTitle = 1
$ppLayoutBlank = 12
$ppSaveAsOpenXMLPresentation = 24

function Clear-ComObject($obj) {
    if ($obj) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj)
    }
}

if (-not (Test-Path $VideoPath)) {
    throw "Video not found: $VideoPath (run prepare-clip.ps1 first)"
}
if (Test-Path $OutputPptx) {
    Remove-Item $OutputPptx -Force
}

Write-Host "Launching PowerPoint..." -ForegroundColor Cyan
$ppt = New-Object -ComObject PowerPoint.Application
# Application.Visible is typed MsoTriState, not a plain bool -- $true throws an
# invalid-cast on the property set. -1 is msoTrue. PowerPoint's automation model
# requires this to actually be true; it will throw elsewhere if you try to run
# hidden, so this window will actually appear during setup.
$ppt.Visible = -1

$pres = $null
try {
    $pres = $ppt.Presentations.Add()

    Write-Host "Adding slide 1 (before)..." -ForegroundColor Cyan
    $slide1 = $pres.Slides.Add(1, $ppLayoutTitle)
    $slide1.Shapes.Title.TextFrame.TextRange.Text = "Slide 1 - before video"

    Write-Host "Adding slide 2 (video)..." -ForegroundColor Cyan
    $slide2 = $pres.Slides.Add(2, $ppLayoutBlank)
    $slideWidth = $pres.PageSetup.SlideWidth
    $slideHeight = $pres.PageSetup.SlideHeight
    # AddMediaObject2(FileName, LinkToFile, SaveWithDocument, Left, Top, Width, Height)
    # LinkToFile=False + SaveWithDocument=True embeds the media bytes into the pptx,
    # matching "embedded, trimmed video" from the original ask.
    $shape = $slide2.Shapes.AddMediaObject2($VideoPath, $false, $true, 0, 0, $slideWidth, $slideHeight)

    Write-Host "Configuring autoplay..." -ForegroundColor Cyan
    # Deliberately minimal: PlayOnEntry is the one property directly relevant to
    # "does it autoplay." StopAfterSlides/PauseAnimation are legacy PPT 2003
    # animation-sequence properties of uncertain interaction with a COM-inserted
    # AddMediaObject2 shape on a modern build -- dropped after the first PoC run
    # crashed PowerPoint shortly after the clip's end, to isolate whether they
    # were the cause.
    $shape.AnimationSettings.PlaySettings.PlayOnEntry = $true
    $shape.AnimationSettings.PlaySettings.HideWhileNotPlaying = $false
    $shape.AnimationSettings.PlaySettings.LoopUntilStopped = $false

    Write-Host "Adding slide 3 (after)..." -ForegroundColor Cyan
    $slide3 = $pres.Slides.Add(3, $ppLayoutTitle)
    $slide3.Shapes.Title.TextFrame.TextRange.Text = "Slide 3 - after video"

    Write-Host "Saving as $OutputPptx ..." -ForegroundColor Cyan
    $pres.SaveAs($OutputPptx, $ppSaveAsOpenXMLPresentation)

    Write-Host "Done: $OutputPptx" -ForegroundColor Green
}
finally {
    if ($pres) { $pres.Close() }
    $ppt.Quit()
    Clear-ComObject $pres
    Clear-ComObject $ppt
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
