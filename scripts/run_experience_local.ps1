$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$collectorPath = Join-Path $PSScriptRoot 'collect_experience_local.js'
$collectorProcess = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $collectorPath + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru
exit $collectorProcess.ExitCode
