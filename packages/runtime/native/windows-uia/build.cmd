@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PROJECT=%SCRIPT_DIR%kiln-windows-uia.vcxproj"

set "MSBUILD=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe"
if not exist "%MSBUILD%" set "MSBUILD=%ProgramFiles%\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe"
if not exist "%MSBUILD%" set "MSBUILD=%ProgramFiles%\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\MSBuild.exe"
if not exist "%MSBUILD%" set "MSBUILD=%ProgramFiles%\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\MSBuild.exe"

if not exist "%MSBUILD%" (
  echo MSBuild was not found. Install Visual Studio 2022 Build Tools with the Desktop development with C++ workload. 1>&2
  exit /b 1
)

"%MSBUILD%" "%PROJECT%" /m /p:Configuration=Release /p:Platform=x64 /nologo
exit /b %ERRORLEVEL%
