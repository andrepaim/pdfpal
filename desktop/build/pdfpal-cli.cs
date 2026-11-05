using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

// Console subsystem launcher. No shell interpolation and no external Node install.
internal static class PdfpalCli
{
    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
            else { result.Append('\\', slashes); result.Append(c); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }

    private static int Main(string[] args)
    {
        try
        {
            string directory = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            var start = new ProcessStartInfo {
                FileName = Path.Combine(directory, "__PDFPAL_EXECUTABLE__"),
                Arguments = Quote(Path.Combine(directory, "resources", "app.asar", "cli.mjs")) + " " + String.Join(" ", args.Select(Quote)),
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            start.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
            start.EnvironmentVariables["PDFPAL_CLI_DESKTOP"] = "1";
            start.EnvironmentVariables["PDFPAL_CLI_LAUNCHER"] = System.Reflection.Assembly.GetExecutingAssembly().Location;
            start.EnvironmentVariables.Remove("NODE_OPTIONS");
            start.EnvironmentVariables.Remove("NODE_PATH");
            using (var child = Process.Start(start))
            {
                if (child == null) throw new IOException();
                var output = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
                var error = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
                var input = Task.Run(async delegate {
                    try { await Console.OpenStandardInput().CopyToAsync(child.StandardInput.BaseStream); child.StandardInput.Close(); }
                    catch (IOException) { }
                    catch (ObjectDisposedException) { }
                });
                Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) {
                    try { if (!child.HasExited) child.Kill(); } catch { }
                };
                child.WaitForExit();
                Task.WaitAll(output, error);
                return child.ExitCode;
            }
        }
        catch
        {
            Console.Error.WriteLine("pdfpal: The bundled CLI could not start. Repair or update the Windows installation.");
            return 1;
        }
    }
}
