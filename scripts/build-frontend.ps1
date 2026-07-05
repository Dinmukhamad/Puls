param(
    [switch]$SplitFromCurrent
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Utf8 = [System.Text.UTF8Encoding]::new($false)

function Ensure-Dir($Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Read-Lines($Path) {
    [System.IO.File]::ReadAllLines($Path)
}

function Write-Text($Path, $Text) {
    [System.IO.File]::WriteAllText($Path, $Text, $Utf8)
}

function Write-LinesRange($SourceLines, $Start, $End, $Path) {
    $slice = $SourceLines[($Start - 1)..($End - 1)]
    Write-Text $Path (($slice -join "`n") + "`n")
}

function Join-Files($Files, $OutPath, $Banner, [switch]$IncludeSourceComments) {
    $chunks = @($Banner)
    foreach ($file in $Files) {
        if ($IncludeSourceComments) {
            $name = Split-Path -Leaf $file
            $chunks += "/* source: $name */"
        }
        $chunks += [System.IO.File]::ReadAllText($file)
    }
    Write-Text $OutPath (($chunks -join "`n") + "`n")
}

function Minify-Css($Text) {
    $Text = [regex]::Replace($Text, '/\*[\s\S]*?\*/', '')
    $Text = [regex]::Replace($Text, '\s+', ' ')
    $Text = [regex]::Replace($Text, '\s*([{}:;,>+~])\s*', '$1')
    $Text = $Text.Replace(';}', '}')
    return $Text.Trim()
}

function Rebuild-MinJsSafe($SourcePath, $OutPath) {
    # Safe fallback when terser is unavailable: preserve JS semantics and only
    # remove the generated banner. Real minification still belongs to terser.
    $text = [System.IO.File]::ReadAllText($SourcePath)
    $text = [regex]::Replace($text, '^/\* Generated from [\s\S]*?\*/\s*', '')
    Write-Text $OutPath $text
}

$JsSrc = Join-Path $Root "js\src"
$AppSrc = Join-Path $JsSrc "app"
$ApiSrc = Join-Path $JsSrc "api"
$CssSrc = Join-Path $Root "css\src"
Ensure-Dir $AppSrc
Ensure-Dir $ApiSrc
Ensure-Dir $CssSrc
Ensure-Dir (Join-Path $ApiSrc "client")
Ensure-Dir (Join-Path $ApiSrc "domains")
Ensure-Dir (Join-Path $JsSrc "auth")
Ensure-Dir (Join-Path $JsSrc "components")
Ensure-Dir (Join-Path $JsSrc "utils")
Ensure-Dir (Join-Path $JsSrc "views")
Ensure-Dir (Join-Path $CssSrc "base")
Ensure-Dir (Join-Path $CssSrc "layout")
Ensure-Dir (Join-Path $CssSrc "components")
Ensure-Dir (Join-Path $CssSrc "views")

function Get-OrderedFiles($Groups, $Filter) {
    $result = @()
    foreach ($group in $Groups) {
        if (Test-Path -LiteralPath $group) {
            $result += Get-ChildItem -Path $group -Filter $Filter -Recurse -File | Sort-Object Name, FullName | Select-Object -ExpandProperty FullName
        }
    }
    return $result
}

if ($SplitFromCurrent) {
    $appLines = Read-Lines (Join-Path $Root "js\app.js")
    Write-LinesRange $appLines 1    630  (Join-Path $AppSrc "00-core-shell.js")
    Write-LinesRange $appLines 631  1279 (Join-Path $JsSrc "views\operator-levels\10-levels-cabinet.view.js")
    Write-LinesRange $appLines 1280 2271 (Join-Path $JsSrc "views\rating\20-rating-shop-summary.view.js")
    Write-LinesRange $appLines 2272 4652 (Join-Path $JsSrc "views\coins\30-admin-coins-groups-operators.view.js")
    Write-LinesRange $appLines 4653 6889 (Join-Path $JsSrc "views\reports\40-reports-analytics.view.js")
    Write-LinesRange $appLines 6890 7331 (Join-Path $JsSrc "views\rating\50-rating-tabs.view.js")
    Write-LinesRange $appLines 7332 $appLines.Length (Join-Path $JsSrc "views\wheel\60-wheel-tests.view.js")

    $apiLines = Read-Lines (Join-Path $Root "js\api.js")
    Write-LinesRange $apiLines 1   64  (Join-Path $ApiSrc "client\00-client-auth.js")
    Write-LinesRange $apiLines 65  154 (Join-Path $ApiSrc "domains\10-main-domains.api.js")
    Write-LinesRange $apiLines 155 242 (Join-Path $ApiSrc "domains\20-reports-analytics-tests.api.js")
    Write-LinesRange $apiLines 243 $apiLines.Length (Join-Path $ApiSrc "domains\30-levels-wheel-export.api.js")

    $cssLines = Read-Lines (Join-Path $Root "css\styles.css")
    Write-LinesRange $cssLines 1    1129 (Join-Path $CssSrc "base\00-base-layout.css")
    Write-LinesRange $cssLines 1130 1464 (Join-Path $CssSrc "views\10-manual-account.css")
    Write-LinesRange $cssLines 1465 2242 (Join-Path $CssSrc "views\20-rating-shop-dashboard.css")
    Write-LinesRange $cssLines 2243 3388 (Join-Path $CssSrc "views\30-analytics-rating-responsive.css")
    Write-LinesRange $cssLines 3389 $cssLines.Length (Join-Path $CssSrc "views\40-coins-tests-wheel-overrides.css")
}

$appFiles = Get-OrderedFiles @(
    (Join-Path $JsSrc "app"),
    (Join-Path $JsSrc "auth"),
    (Join-Path $JsSrc "components"),
    (Join-Path $JsSrc "utils"),
    (Join-Path $JsSrc "views")
) "*.js"
$apiFiles = Get-OrderedFiles @(
    (Join-Path $ApiSrc "client"),
    (Join-Path $ApiSrc "domains")
) "*.js"
$cssFiles = Get-OrderedFiles @(
    (Join-Path $CssSrc "base"),
    (Join-Path $CssSrc "layout"),
    (Join-Path $CssSrc "components"),
    (Join-Path $CssSrc "views")
) "*.css"

Join-Files $apiFiles (Join-Path $Root "js\api.js") "/* Generated from js/src/api/**/*.js. Run npm run build after editing. */"
Join-Files $appFiles (Join-Path $Root "js\app.js") "/* Generated from js/src/{app,auth,components,utils,views}/**/*.js. Run npm run build after editing. */"
Join-Files $cssFiles (Join-Path $Root "css\styles.css") "/* Generated from css/src/{base,layout,components,views}/**/*.css. Run npm run build after editing. */" -IncludeSourceComments

Rebuild-MinJsSafe (Join-Path $Root "js\api.js") (Join-Path $Root "js\api.min.js")
Rebuild-MinJsSafe (Join-Path $Root "js\app.js") (Join-Path $Root "js\app.min.js")

$styles = [System.IO.File]::ReadAllText((Join-Path $Root "css\styles.css"))
Write-Text (Join-Path $Root "css\styles.min.css") (Minify-Css $styles)

$tokens = [System.IO.File]::ReadAllText((Join-Path $Root "css\tokens.css"))
Write-Text (Join-Path $Root "css\tokens.min.css") (Minify-Css $tokens)
