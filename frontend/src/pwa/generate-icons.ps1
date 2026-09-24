# Reproducible vector and raster exports of the application's PulsMark.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\public\icons'))
New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null
$markPath = 'M112 274H178L204 202L246 320L283 176L313 274H400'
$points = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(112,274), [System.Drawing.PointF]::new(178,274),
    [System.Drawing.PointF]::new(204,202), [System.Drawing.PointF]::new(246,320),
    [System.Drawing.PointF]::new(283,176), [System.Drawing.PointF]::new(313,274),
    [System.Drawing.PointF]::new(400,274)
)

function RoundedTile([int]$radius) {
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $radius * 2
    $path.AddArc(0,0,$diameter,$diameter,180,90)
    $path.AddArc((512-$diameter),0,$diameter,$diameter,270,90)
    $path.AddArc((512-$diameter),(512-$diameter),$diameter,$diameter,0,90)
    $path.AddArc(0,(512-$diameter),$diameter,$diameter,90,90)
    $path.CloseFigure()
    return ,$path
}

function Export-PulsIcon([int]$size, [string]$name, [bool]$maskable = $false) {
    # Supersampling keeps the pulse clear in small favicon sizes.
    $scale = [Math]::Max(512, $size * 2)
    $bitmap = [System.Drawing.Bitmap]::new($scale, $scale)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($scale / 512.0, $scale / 512.0)
    $shape = RoundedTile 112
    if (-not $maskable) { $graphics.SetClip($shape) }
    $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        [System.Drawing.Point]::new(0,0), [System.Drawing.Point]::new(512,512),
        [System.Drawing.ColorTranslator]::FromHtml('#3A3E46'),
        [System.Drawing.ColorTranslator]::FromHtml('#17191E'))
    $graphics.FillRectangle($gradient,0,0,512,512)
    $highlight = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(17,255,255,255))
    $graphics.FillEllipse($highlight,-125,-230,700,590)
    $shadow = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(35,49,35,133),30)
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White,28)
    foreach($stroke in @($shadow,$pen)) {
        $stroke.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $stroke.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $stroke.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    }
    $graphics.TranslateTransform(0,5)
    $graphics.DrawLines($shadow,$points)
    $graphics.TranslateTransform(0,-5)
    $graphics.DrawLines($pen,$points)
    $output = [System.Drawing.Bitmap]::new($size,$size)
    $resizer = [System.Drawing.Graphics]::FromImage($output)
    $resizer.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $resizer.DrawImage($bitmap,0,0,$size,$size)
    $output.Save((Join-Path $iconDirectory $name),[System.Drawing.Imaging.ImageFormat]::Png)
    $resizer.Dispose(); $output.Dispose(); $pen.Dispose(); $shadow.Dispose(); $highlight.Dispose()
    $gradient.Dispose(); $shape.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

$svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="tile" x2="1" y2="1"><stop stop-color="#3A3E46"/><stop offset="1" stop-color="#17191E"/></linearGradient><clipPath id="clip"><rect width="512" height="512" rx="112"/></clipPath></defs><g clip-path="url(#clip)"><rect width="512" height="512" fill="url(#tile)"/><ellipse cx="225" cy="65" rx="350" ry="295" fill="#fff" opacity=".067"/><path d="$markPath" transform="translate(0 5)" fill="none" stroke="#000000" stroke-opacity=".137" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/><path d="$markPath" fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/></g></svg>
"@
[System.IO.File]::WriteAllText((Join-Path $iconDirectory 'puls-light.svg'),$svg)
[System.IO.File]::WriteAllText((Join-Path $iconDirectory '..\favicon.svg'),$svg)
$dark = $svg.Replace('#3A3E46','#2A2C32').Replace('#17191E','#111214').Replace('stroke="#fff"','stroke="#FFFFFF"')
[System.IO.File]::WriteAllText((Join-Path $iconDirectory 'puls-dark.svg'),$dark)
Export-PulsIcon 32 'puls-favicon-v4.png'
Export-PulsIcon 192 'puls-app-192-v4.png'
Export-PulsIcon 512 'puls-app-512-v4.png'
Export-PulsIcon 512 'puls-maskable-v4.png' $true
Export-PulsIcon 180 'apple-touch-icon-v4.png' $true
# Preserve older installed manifests while they transition to the new asset URLs.
Copy-Item (Join-Path $iconDirectory 'puls-app-192-v4.png') (Join-Path $iconDirectory 'puls-192.png')
Copy-Item (Join-Path $iconDirectory 'puls-app-512-v4.png') (Join-Path $iconDirectory 'puls-512.png')
Copy-Item (Join-Path $iconDirectory 'puls-maskable-v4.png') (Join-Path $iconDirectory 'puls-maskable-512.png')
Copy-Item (Join-Path $iconDirectory 'apple-touch-icon-v4.png') (Join-Path $iconDirectory 'apple-touch-icon.png')
