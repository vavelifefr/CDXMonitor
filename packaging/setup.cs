using System;
using System.Diagnostics;
using System.IO;

// CDXMonitor setup: runs install.ps1 from its own folder in a visible console.
// Build: csc /nologo /optimize /target:exe /out:setup.exe setup.cs
sealed class Setup
{
    const string Version = "0.4.0";

    static int Main(string[] args)
    {
        foreach (string a in args)
        {
            if (a == "--version" || a == "-v")
            {
                Console.WriteLine("CDXMonitor setup " + Version);
                return 0;
            }
            if (a == "--help" || a == "-h" || a == "/?")
            {
                Console.WriteLine("Usage: setup.exe [--version]");
                Console.WriteLine("Runs install.ps1 from this folder (double-click to install).");
                return 0;
            }
        }

        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string ps1 = Path.Combine(dir, "install.ps1");
        if (!File.Exists(ps1))
        {
            Console.Error.WriteLine("install.ps1 not found next to setup.exe");
            return 1;
        }

        var psi = new ProcessStartInfo(
            "powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -File \"" + ps1 + "\"");
        psi.UseShellExecute = false;
        psi.WorkingDirectory = dir;
        try
        {
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                Console.WriteLine("Installer exit code: " + p.ExitCode);
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Failed to start installer: " + ex.Message);
            return 1;
        }
    }
}
