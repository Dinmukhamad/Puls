$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Utf8 = [System.Text.UTF8Encoding]::new($false)

function Ensure-Dir($Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Write-Text($Path, $Text) {
    [System.IO.File]::WriteAllText($Path, $Text, $Utf8)
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
Ensure-Dir (Join-Path $CssSrc "system")

function Get-OrderedFiles($Groups, $Filter) {
    $result = @()
    foreach ($group in $Groups) {
        if (Test-Path -LiteralPath $group) {
            $result += Get-ChildItem -Path $group -Filter $Filter -Recurse -File | Sort-Object Name, FullName | Select-Object -ExpandProperty FullName
        }
    }
    return $result
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
    (Join-Path $CssSrc "views"),
    (Join-Path $CssSrc "system")
) "*.css"

Join-Files $apiFiles (Join-Path $Root "js\api.js") "/* Generated from js/src/api source files. Run npm run build after editing. */"
Join-Files $appFiles (Join-Path $Root "js\app.js") "/* Generated from js/src app source files. Run npm run build after editing. */"
Join-Files $cssFiles (Join-Path $Root "css\styles.css") "/* Generated from css/src source files. Run npm run build after editing. */" -IncludeSourceComments
