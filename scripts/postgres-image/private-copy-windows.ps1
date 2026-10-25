$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  if ($PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion.Major -ne 7 -or -not $IsWindows) { throw 'invalid' }
  $parameters = @{}
  if (($args.Count -ne 4) -and ($args.Count -ne 8) -and ($args.Count -ne 12)) { throw 'invalid' }
  for ($index = 0; $index -lt $args.Count; $index += 2) {
    $name = $args[$index]
    if ($name -cnotin @('-Operation', '-Scope', '-ExpectedSha256', '-ExpectedBytes', '-ExpectedFileId', '-ExpectedDirectoryFileId') -or $parameters.ContainsKey($name)) { throw 'invalid' }
    $parameters[$name] = $args[$index + 1]
  }
  $operation = $parameters['-Operation']; $scope = $parameters['-Scope']
  if ($operation -cnotin @('Receive', 'Export', 'Seal', 'PreparePublish', 'Publish', 'AbortPublish') -or $scope -cnotmatch '^[a-f0-9]{24}$') { throw 'invalid' }
  [long]$expectedBytes = 0; $expectedSha256 = [NullString]::Value; $expectedFileId = [NullString]::Value; $expectedDirectoryFileId = [NullString]::Value
  if ($operation -cin @('Publish', 'AbortPublish')) {
    if ($parameters['-ExpectedFileId'] -cnotmatch '^[a-f0-9]{16}$' -or $parameters['-ExpectedDirectoryFileId'] -cnotmatch '^[a-f0-9]{16}$') { throw 'invalid' }
    $expectedFileId = $parameters['-ExpectedFileId']; $expectedDirectoryFileId = $parameters['-ExpectedDirectoryFileId']
  }
  if ($operation -ceq 'Publish') {
    if ($args.Count -ne 12 -or $parameters['-ExpectedSha256'] -cnotmatch '^[a-f0-9]{64}$' -or $parameters['-ExpectedBytes'] -cnotmatch '^[1-9][0-9]{0,4}$') { throw 'invalid' }
    $expectedBytes = [long]$parameters['-ExpectedBytes']; $expectedSha256 = $parameters['-ExpectedSha256']
    if ($expectedBytes -gt 65536) { throw 'invalid' }
  } elseif ($operation -ceq 'AbortPublish') {
    if ($args.Count -ne 8 -or $parameters.ContainsKey('-ExpectedSha256') -or $parameters.ContainsKey('-ExpectedBytes')) { throw 'invalid' }
  } elseif ($args.Count -ne 4 -or $parameters.ContainsKey('-ExpectedFileId') -or $parameters.ContainsKey('-ExpectedDirectoryFileId')) { throw 'invalid' }
  Add-Type -Path (Join-Path $PSScriptRoot 'private-copy-windows.cs')
  $pins = [AutoWorld.PrivateCopy.Pin[]]@(
    [AutoWorld.PrivateCopy.Pin]::new('candidate.tar', 305474048, '2c1b6b002076fa3772aa9fc899befb86fe525aee1ee1c8007d85bba200c73a05'),
    [AutoWorld.PrivateCopy.Pin]::new('retention-receipt.json', 18352, '9349397a47cf86cfe265cad313318f27eaa71dce2f43e57077225e426a7c0cd0'))
  $config = [AutoWorld.PrivateCopy.Configuration]::new(
    'C:\Users\Administrator\Documents\ChatGPT\Auto-world\.omx\private-archive',
    'S-1-5-21-3270712108-3124063012-814912821-500', 'S-1-5-32-544', 'postgres-0045bdab5483336d-copy-', $pins)
  $result = [AutoWorld.PrivateCopy.Native]::Execute($config, $operation, $scope,
    [Console]::OpenStandardInput(), [Console]::OpenStandardOutput(), $expectedSha256, $expectedBytes, $expectedFileId, $expectedDirectoryFileId)
  if ($operation -cne 'Export') { [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 12 -Compress)) }
  exit 0
} catch {
  [Console]::Error.WriteLine('{"state":"INCOMPLETE","code":"windows_private_copy_incomplete"}')
  exit 1
}
