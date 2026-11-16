$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
  $expectedHost = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe'
  $expectedSource = Join-Path $PSScriptRoot 'retention-private-copy-windows.cs'
  if (-not $IsWindows -or $PSVersionTable.PSEdition -cne 'Core' -or $PSVersionTable.PSVersion.ToString() -cne '7.6.9' -or
      [Environment]::ProcessPath -ine $expectedHost) { throw 'invalid' }

  function Get-Sha256([string]$path) {
    $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
      $hash = [System.Security.Cryptography.SHA256]::HashData($stream)
      return [Convert]::ToHexString($hash).ToLowerInvariant()
    } finally { $stream.Dispose() }
  }

  if ((Get-Item -LiteralPath $expectedHost).Length -ne 301360 -or
      (Get-Sha256 $expectedHost) -cne '2a6769a3330dc1084d0154bfde7d164ab750ca7f700f313f9d417c1be78b2233' -or
      (Get-Item -LiteralPath $expectedSource).Length -ne 40272 -or
      (Get-Sha256 $expectedSource) -cne 'dcb3556580eba223820d0ef7edcb5e9a7f005519c186d32f0d432f573f1fe5e2') { throw 'invalid' }

  if (($args.Count % 2) -ne 0) { throw 'invalid' }
  $parameters = @{}
  for ($index = 0; $index -lt $args.Count; $index += 2) {
    $name = $args[$index]
    if ($name -cnotin @('-Operation', '-Phase', '-InnerTarSha256', '-InnerTarBytes', '-VolumeSerial', '-DirectoryFileId', '-TarFileId', '-SidecarSha256', '-SidecarBytes', '-SidecarFileId', '-RestoreNonce', '-RestoreManifestSha256', '-RestoreManifestBytes') -or
        $parameters.ContainsKey($name)) { throw 'invalid' }
    $parameters[$name] = $args[$index + 1]
  }

  $operation = $parameters['-Operation']
  if ($operation -cnotin @('StageTar', 'CommitPair', 'InspectPair', 'ExportTar', 'InspectRestore', 'CleanupRestore') -or
      $parameters['-InnerTarSha256'] -cnotmatch '^[a-f0-9]{64}$') { throw 'invalid' }
  [long]$innerTarBytes = 0
  if ($operation -cne 'InspectRestore' -and $operation -cne 'CleanupRestore') {
    if ($parameters['-InnerTarBytes'] -cnotmatch '^[1-9][0-9]{0,8}$') { throw 'invalid' }
    $innerTarBytes = $parameters['-InnerTarBytes']
    if ($innerTarBytes -gt 468374629) { throw 'invalid' }
  }

  $common = @('-Operation', '-InnerTarSha256', '-InnerTarBytes')
  $commit = @('-VolumeSerial', '-DirectoryFileId', '-TarFileId', '-SidecarSha256', '-SidecarBytes')
  $pair = @('-SidecarFileId')
  $restore = @('-Operation', '-Phase', '-InnerTarSha256', '-RestoreNonce', '-RestoreManifestSha256', '-RestoreManifestBytes')
  $required = if ($operation -ceq 'InspectRestore') {
    if ($parameters['-Phase'] -ceq 'EMPTY') { $restore } elseif ($parameters['-Phase'] -ceq 'SEALED') { $restore + @('-VolumeSerial', '-DirectoryFileId') } else { throw 'invalid' }
  } elseif ($operation -ceq 'CleanupRestore') {
    @('-Operation', '-InnerTarSha256', '-RestoreNonce', '-RestoreManifestSha256', '-RestoreManifestBytes', '-VolumeSerial', '-DirectoryFileId')
  } elseif ($operation -ceq 'StageTar') { $common } elseif ($operation -ceq 'CommitPair') { $common + $commit } else { $common + $commit + $pair }
  if ($args.Count -ne (2 * $required.Count) -or $parameters.Count -ne $required.Count -or
      $required.Where({ -not $parameters.ContainsKey($_) }).Count -ne 0) { throw 'invalid' }

  [long]$sidecarBytes = 0
  $volumeSerial = [NullString]::Value; $directoryFileId = [NullString]::Value; $tarFileId = [NullString]::Value
  $sidecarSha256 = [NullString]::Value; $sidecarFileId = [NullString]::Value
  if ($operation -cne 'StageTar' -and $operation -cne 'InspectRestore' -and $operation -cne 'CleanupRestore') {
    if ($parameters['-VolumeSerial'] -cnotmatch '^[a-f0-9]{8}$' -or
        $parameters['-DirectoryFileId'] -cnotmatch '^[a-f0-9]{16}$' -or
        $parameters['-TarFileId'] -cnotmatch '^[a-f0-9]{16}$' -or
        $parameters['-SidecarSha256'] -cnotmatch '^[a-f0-9]{64}$' -or
        $parameters['-SidecarBytes'] -cnotmatch '^[1-9][0-9]{0,4}$') { throw 'invalid' }
    [long]$sidecarBytes = $parameters['-SidecarBytes']
    if ($sidecarBytes -gt 65536) { throw 'invalid' }
    $volumeSerial = $parameters['-VolumeSerial']; $directoryFileId = $parameters['-DirectoryFileId']; $tarFileId = $parameters['-TarFileId']; $sidecarSha256 = $parameters['-SidecarSha256']
  }
  if ($operation -cin @('InspectPair', 'ExportTar')) {
    if ($parameters['-SidecarFileId'] -cnotmatch '^[a-f0-9]{16}$') { throw 'invalid' }
    $sidecarFileId = $parameters['-SidecarFileId']
  }

  [long]$restoreManifestBytes = 0
  if ($operation -ceq 'InspectRestore' -or $operation -ceq 'CleanupRestore') {
    if ($parameters['-RestoreNonce'] -cnotmatch '^[a-f0-9]{32}$' -or
        $parameters['-RestoreManifestSha256'] -cnotmatch '^[a-f0-9]{64}$' -or
        $parameters['-RestoreManifestBytes'] -cnotmatch '^[1-9][0-9]{0,6}$') { throw 'invalid' }
    $restoreManifestBytes = $parameters['-RestoreManifestBytes']
    if ($restoreManifestBytes -gt 2097152) { throw 'invalid' }
    if ($parameters['-Phase'] -ceq 'SEALED' -or $operation -ceq 'CleanupRestore') {
      if ($parameters['-VolumeSerial'] -cnotmatch '^[a-f0-9]{8}$' -or $parameters['-DirectoryFileId'] -cnotmatch '^[a-f0-9]{16}$') { throw 'invalid' }
      $volumeSerial = $parameters['-VolumeSerial']; $directoryFileId = $parameters['-DirectoryFileId']
    }
  }

  Add-Type -LiteralPath $expectedSource
  $config = [AutoWorld.ScannerRetentionPrivateCopy.Configuration]::new(
    'C:\Users\Administrator\Documents\ChatGPT\Auto-world\.omx\private-archive',
    'S-1-5-21-3270712108-3124063012-814912821-500', 'S-1-5-32-544', 'scanner')
  if ($operation -ceq 'InspectRestore') {
    $result = [AutoWorld.ScannerRetentionPrivateCopy.Native]::InspectRestore(
      $config, $parameters['-Phase'], [Console]::OpenStandardInput(), $parameters['-InnerTarSha256'],
      $parameters['-RestoreNonce'], $parameters['-RestoreManifestSha256'], $restoreManifestBytes, $volumeSerial, $directoryFileId)
  } elseif ($operation -ceq 'CleanupRestore') {
    $result = [AutoWorld.ScannerRetentionPrivateCopy.Native]::CleanupRestore(
      $config, [Console]::OpenStandardInput(), $parameters['-InnerTarSha256'], $parameters['-RestoreNonce'],
      $parameters['-RestoreManifestSha256'], $restoreManifestBytes, $volumeSerial, $directoryFileId)
  } else {
    $result = [AutoWorld.ScannerRetentionPrivateCopy.Native]::Execute(
      $config, $operation, [Console]::OpenStandardInput(), [Console]::OpenStandardOutput(),
      $parameters['-InnerTarSha256'], $innerTarBytes, $volumeSerial, $directoryFileId, $tarFileId,
      $sidecarSha256, $sidecarBytes, $sidecarFileId)
  }
  if ($operation -cne 'ExportTar') { [Console]::Out.Write((($result | ConvertTo-Json -Depth 12 -Compress) + "`n")) }
  exit 0
} catch {
  [Console]::Error.WriteLine('{"state":"INCOMPLETE","code":"scanner_retention_private_copy_incomplete"}')
  exit 1
}
