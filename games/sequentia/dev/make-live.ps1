# Regenerates dev/live.html: a byte-faithful copy of index.html whose asset URLs
# carry a fresh cache-busting token.
#
# Why this exists: some embedded/preview browsers cache file:// scripts hard enough
# that editing js/*.js and reloading index.html keeps running the OLD code, which
# silently invalidates any manual testing. A unique query string per generation is
# a URL the cache has never seen, so the fresh code always wins.
#
# Windows PowerShell 5.1 gotchas, both hit while writing this:
#   1. Get-Content/Set-Content default to the ANSI codepage, which double-decodes
#      UTF-8 (an ellipsis becomes three mojibake bytes). Always go through
#      System.IO with an explicit UTF8 encoding, and no BOM to match index.html.
#   2. .ps1 files themselves are parsed as ANSI, so this script stays pure ASCII
#      and builds any non-ASCII test strings from code points.
#
# Usage:  powershell -ExecutionPolicy Bypass -File dev\make-live.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'index.html'
$dst = Join-Path $root 'dev\live.html'

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$html = [System.IO.File]::ReadAllText($src, [System.Text.Encoding]::UTF8)

$token = Get-Date -Format 'yyyyMMddHHmmss'

# dev/live.html sits one level down, so asset paths need a ../ prefix.
$html = $html -replace 'src="js/', 'src="../js/'
$html = $html -replace 'href="css/', 'href="../css/'
$html = [regex]::Replace($html, '(src="\.\./js/[^"]+\.js)"', ('$1?v=' + $token + '"'))
$html = [regex]::Replace($html, '(href="\.\./css/[^"]+\.css)"', ('$1?v=' + $token + '"'))

# Make it obvious in the tab which copy is being looked at.
$html = $html -replace '<title>Sequentia</title>', ('<title>Sequentia (live ' + $token + ')</title>')

[System.IO.File]::WriteAllText($dst, $html, $utf8NoBom)

# Guard: U+00E2 U+20AC is the signature of UTF-8 read as Windows-1252.
$mojibake = [string][char]0x00E2 + [char]0x20AC
if ($html.Contains($mojibake)) { throw 'Encoding got mangled - refusing to leave a corrupt harness.' }
# Sanity: the real ellipsis from index.html must have survived intact.
if (-not $html.Contains([string][char]0x2026)) { Write-Warning 'No U+2026 found; check the source.' }

Write-Output ('dev/live.html regenerated, token ' + $token)
