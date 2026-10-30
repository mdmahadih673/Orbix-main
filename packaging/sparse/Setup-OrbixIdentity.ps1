param(
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$exe = Join-Path $repoRoot 'src-tauri/target/release/orbix.exe'
$packageDir = Join-Path $repoRoot 'packaging/sparse'
$tempRoot = Join-Path $env:LOCALAPPDATA 'Temp'
$stage = Join-Path $tempRoot 'OrbixSparsePackage'
$msix = Join-Path $tempRoot 'OrbixSparse.msix'
$publisher = 'CN=Orbix Development'
$packageName = 'Orbix.Desktop'
$sdkBin = 'C:\Program Files (x86)\Windows Kits\10\bin'
$makeAppx = Get-ChildItem $sdkBin -Filter makeappx.exe -Recurse | Where-Object FullName -Match '\\x64\\makeappx.exe$' | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
$signTool = Get-ChildItem $sdkBin -Filter signtool.exe -Recurse | Where-Object FullName -Match '\\x64\\signtool.exe$' | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
$mt = Get-ChildItem $sdkBin -Filter mt.exe -Recurse | Where-Object FullName -Match '\\x64\\mt.exe$' | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName

if ($Uninstall) {
  Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue | Remove-AppxPackage
  Write-Host 'Orbix sparse package identity removed.'
  exit 0
}
if (!(Test-Path $exe)) { throw "Build Orbix first; executable not found: $exe" }
if (!$makeAppx -or !$signTool -or !$mt) { throw 'Windows SDK MakeAppx.exe, SignTool.exe, and mt.exe are required.' }

# Keep Windows Common Controls v6 activated while adding the package identity.
$appManifest = Join-Path $packageDir 'Orbix.identity.manifest'
& $mt -manifest $appManifest "-outputresource:$exe;#1"
if ($LASTEXITCODE -ne 0) { throw 'Embedding the matching package identity manifest failed.' }
New-Item -ItemType Directory -Path (Join-Path (Split-Path $exe) 'Assets') -Force | Out-Null
Copy-Item (Join-Path $repoRoot 'src-tauri/icons/StoreLogo.png') (Join-Path (Split-Path $exe) 'Assets/StoreLogo.png') -Force
Copy-Item (Join-Path $repoRoot 'src-tauri/icons/Square150x150Logo.png') (Join-Path (Split-Path $exe) 'Assets/Square150x150Logo.png') -Force
Copy-Item (Join-Path $repoRoot 'src-tauri/icons/Square44x44Logo.png') (Join-Path (Split-Path $exe) 'Assets/Square44x44Logo.png') -Force

if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item (Join-Path $packageDir 'AppxManifest.xml') (Join-Path $stage 'AppxManifest.xml')
if (Test-Path $msix) { Remove-Item -LiteralPath $msix -Force }
& $makeAppx pack /d $stage /p $msix /o /nv
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx failed.' }

$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $publisher -and $_.HasPrivateKey } | Select-Object -First 1
if (!$cert) {
  $cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature -FriendlyName 'Orbix local sparse package signing' -CertStoreLocation Cert:\CurrentUser\My -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')
}
$trusted = Get-ChildItem Cert:\CurrentUser\TrustedPeople | Where-Object Thumbprint -eq $cert.Thumbprint
$trustedRoot = Get-ChildItem Cert:\CurrentUser\Root | Where-Object Thumbprint -eq $cert.Thumbprint
if (!$trusted -or !$trustedRoot) {
  $publicCert = Join-Path $tempRoot 'OrbixPublisher.cer'
  $cert | Export-Certificate -FilePath $publicCert -Force | Out-Null
  if (!$trusted) { Import-Certificate -FilePath $publicCert -CertStoreLocation Cert:\CurrentUser\TrustedPeople | Out-Null }
  if (!$trustedRoot) { Import-Certificate -FilePath $publicCert -CertStoreLocation Cert:\CurrentUser\Root | Out-Null }
  Remove-Item $publicCert -Force
}
& $signTool sign /fd SHA256 /sha1 $cert.Thumbprint /s My $msix
if ($LASTEXITCODE -ne 0) { throw 'Signing the sparse package failed.' }
Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue | Remove-AppxPackage
Add-AppxPackage -Path $msix -ExternalLocation (Split-Path $exe)
Write-Host 'Orbix package identity is registered for this Windows user.'
Write-Host 'Open Orbix and use its notification permission control to ask Windows for notification access.'
