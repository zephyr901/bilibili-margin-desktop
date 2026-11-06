#Requires -Version 7.2
param(
  [Parameter(Mandatory = $true)][string]$OfficialRoot,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist'),
  [string]$MarginZip
)

$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'Building the desktop package requires Windows.' }
$node = (Get-Command node -CommandType Application).Source
$nodeVersion = & $node -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'24.0') {
  throw 'Install Node.js 24 or newer before building.'
}

$officialDir = (Resolve-Path -LiteralPath $OfficialRoot).ProviderPath
if (!(Test-Path -LiteralPath (Join-Path $officialDir 'resources/app.asar') -PathType Leaf) -or
    !(Test-Path -LiteralPath (Join-Path $officialDir '哔哩哔哩.exe') -PathType Leaf)) {
  throw 'OfficialRoot must be the folder containing 哔哩哔哩.exe and resources/app.asar.'
}
$bundleName = 'MARGIN-Bilibili-0.2.0-Windows-x64'
$publishDir = [IO.Path]::GetFullPath($OutputDirectory)
$zipPath = Join-Path $publishDir "$bundleName.zip"
if (Test-Path -LiteralPath $zipPath) { throw "Archive already exists: $zipPath" }
if ($MarginZip) { $MarginZip = (Resolve-Path -LiteralPath $MarginZip).ProviderPath }

$tempRoot = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).ProviderPath
$run = Join-Path $tempRoot ('margin-desktop-build-' + [Guid]::NewGuid().ToString('N'))
$root = Join-Path $run $bundleName
$extensionDir = Join-Path $run 'extension'
$assetsDir = Join-Path $run 'assets'
$clientDir = Join-Path $root 'client'
$buildEnv = @{
  MARGIN_EXTENSION_ROOT = $extensionDir
  MARGIN_OFFICIAL_ROOT = $officialDir
  MARGIN_DESKTOP_OUTPUT = $clientDir
  MARGIN_DESKTOP_ASSETS = $assetsDir
}
$oldEnv = @{}
$tempZip = Join-Path $publishDir ('.' + [Guid]::NewGuid().ToString('N') + '.zip.tmp')

try {
  New-Item -ItemType Directory -Path $root,$publishDir -Force | Out-Null
  if (!$MarginZip) {
    $MarginZip = Join-Path $run 'margin.zip'
    $url = 'https://github.com/jiuyang5354/bilibili-margin/releases/download/v0.52.0/margin.zip'
    Invoke-WebRequest -Uri $url -OutFile $MarginZip
  }
  $upstreamSHA = 'e679f349847ab66e360d941776b5a5c62a6472fc944464a77343802ae5eac3b8'
  if ((Get-FileHash -LiteralPath $MarginZip).Hash.ToLowerInvariant() -ne $upstreamSHA) {
    throw 'The supplied margin.zip does not match the upstream v0.52.0 Chrome/Edge release.'
  }
  [IO.Compression.ZipFile]::ExtractToDirectory($MarginZip, $extensionDir)

  foreach ($name in $buildEnv.Keys) {
    $oldEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $buildEnv[$name], 'Process')
  }
  & $node (Join-Path $PSScriptRoot 'desktop-port/build.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Client build failed.' }
  $report = Get-Content -LiteralPath (Join-Path $clientDir 'build-report.json') -Raw | ConvertFrom-Json
  $archive = Join-Path $clientDir 'resources/app.asar'
  if (!$report.officialUnchanged -or (Get-FileHash -LiteralPath $archive).Hash.ToLowerInvariant() -ne $report.portableSha256) {
    throw 'The client archive failed validation.'
  }

  Copy-Item -Path (Join-Path $PSScriptRoot 'desktop-port/release/*') -Destination $root
  $licenseDir = Join-Path $root 'licenses'
  New-Item -ItemType Directory -Path $licenseDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'LICENSE') -Destination (Join-Path $licenseDir 'LICENSE-Desktop-and-MARGIN.txt')
  Copy-Item -LiteralPath (Join-Path $assetsDir 'LICENSE-MARGIN.txt'),(Join-Path $assetsDir 'fonts/FONTS-LICENSES.md') -Destination $licenseDir
  Copy-Item -LiteralPath (Join-Path $assetsDir 'fonts/licenses') -Destination (Join-Path $licenseDir 'fonts') -Recurse

  $manifest = foreach ($file in (Get-ChildItem -LiteralPath $root -File -Recurse -Force | Sort-Object FullName)) {
    $relative = [IO.Path]::GetRelativePath($root, $file.FullName).Replace('\','/')
    '{0}  {1}' -f (Get-FileHash -LiteralPath $file.FullName).Hash.ToLowerInvariant(), $relative
  }
  $manifest | Set-Content -LiteralPath (Join-Path $root 'MANIFEST-SHA256.txt') -Encoding utf8
  [IO.Compression.ZipFile]::CreateFromDirectory($root, $tempZip, [IO.Compression.CompressionLevel]::Optimal, $true, [Text.Encoding]::UTF8)
  Move-Item -LiteralPath $tempZip -Destination $zipPath
  [pscustomobject]@{Archive = $zipPath; SHA256 = (Get-FileHash -LiteralPath $zipPath).Hash.ToLowerInvariant()}
} finally {
  foreach ($name in $oldEnv.Keys) {
    [Environment]::SetEnvironmentVariable($name, $oldEnv[$name], 'Process')
  }
  if (Test-Path -LiteralPath $tempZip -PathType Leaf) { Remove-Item -LiteralPath $tempZip }
  if (Test-Path -LiteralPath $run -PathType Container) {
    $built = (Resolve-Path -LiteralPath $run).ProviderPath
    if ([IO.Path]::GetDirectoryName($built) -eq $tempRoot.TrimEnd('\') -and
        [IO.Path]::GetFileName($built) -match '^margin-desktop-build-[0-9a-f]{32}$') {
      Remove-Item -LiteralPath $built -Recurse -Force
    }
  }
}
