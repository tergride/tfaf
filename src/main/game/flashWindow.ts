import { execFile } from 'node:child_process';

const TIMEOUT_MS = 15_000;

/**
 * PowerShell that flashes the taskbar button of a process's main window with FlashWindowEx. FLASHW_ALL with
 * FLASHW_TIMERNOFG (3 | 12) keeps it flashing until the window comes to the front, so focus need not be watched.
 */
export function flashWindowScript(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid process id ${pid}`);
  }
  // Errors go to stderr as plain text: PowerShell would otherwise serialise them, with its progress, as CLIXML.
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TfafFlashWindow {
  [StructLayout(LayoutKind.Sequential)]
  public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }
  [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO info);
  public static void Flash(IntPtr hwnd) {
    var info = new FLASHWINFO();
    info.cbSize = (uint)Marshal.SizeOf(info);
    info.hwnd = hwnd;
    info.dwFlags = 3 | 12;
    FlashWindowEx(ref info);
  }
}
'@
  $handle = (Get-Process -Id ${pid}).MainWindowHandle
  if ($handle -eq [IntPtr]::Zero) { throw 'The process has no window' }
  [TfafFlashWindow]::Flash($handle)
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;
}

/** Makes the Forged Alliance button on the taskbar flash, as the official client does when the lobby is full. */
export function flashGameWindow(pid: number): Promise<void> {
  const encoded = Buffer.from(flashWindowScript(pid), 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', encoded],
      { timeout: TIMEOUT_MS, windowsHide: true },
      (error, _stdout, stderr) => (error ? reject(new Error(stderr.trim() || error.message)) : resolve()),
    );
  });
}
