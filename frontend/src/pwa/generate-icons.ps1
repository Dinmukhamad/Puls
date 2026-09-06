# Deterministic native raster export of the same rounded P used by the SVG icons.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\public\icons'))
New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null

function Export-PulsIcon([int]$size, [string]$name, [bool]$maskable = $false) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($size / 512.0, $size / 512.0)
    $blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#4F68FF'))
    $background = [System.Drawing.Drawing2D.GraphicsPath]::new()
    if ($maskable) { $background.AddRectangle([System.Drawing.RectangleF]::new(0, 0, 512, 512)) }
    else {
        $background.AddArc(0, 0, 208, 208, 180, 90)
        $background.AddArc(304, 0, 208, 208, 270, 90)
        $background.AddArc(304, 304, 208, 208, 0, 90)
        $background.AddArc(0, 304, 208, 208, 90, 90)
        $background.CloseFigure()
    }
    $graphics.FillPath($blue, $background)
    $mark = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $mark.AddLine(182, 356, 182, 156)
    $mark.AddLine(182, 156, 268, 156)
    $mark.AddBezier(268, 156, 320, 156, 350, 184, 350, 228)
    $mark.AddBezier(350, 228, 350, 272, 320, 300, 268, 300)
    $mark.AddLine(268, 300, 234, 300)
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 40)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawPath($pen, $mark)
    $bitmap.Save((Join-Path $iconDirectory $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $pen.Dispose(); $mark.Dispose(); $background.Dispose(); $blue.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

Export-PulsIcon 192 'puls-192.png'
Export-PulsIcon 512 'puls-512.png'
Export-PulsIcon 512 'puls-maskable-512.png' $true
Export-PulsIcon 180 'apple-touch-icon.png' $true
