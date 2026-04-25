param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,

  [Parameter(Mandatory = $true)]
  [string]$OodlePath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ArchivePath) -or -not (Test-Path -LiteralPath $OodlePath)) {
  Write-Output '[]'
  exit 0
}

$escapedOodlePath = $OodlePath.Replace('\', '\\').Replace('"', '\"')

$source = @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class HyperionLxrsReader
{
    private const int FooterHeaderSize = 20;

    [DllImport("__OODLE_PATH__", EntryPoint = "OodleLZ_Decompress", CallingConvention = CallingConvention.StdCall)]
    private static extern int OodleLZDecompress(
        byte[] compBuf,
        long compBufSize,
        byte[] rawBuf,
        long rawLen,
        int fuzzSafe,
        int checkCrc,
        int verbosity,
        IntPtr decBufBase,
        long decBufSize,
        IntPtr fpCallback,
        IntPtr callbackUserData,
        IntPtr decoderMemory,
        long decoderMemorySize,
        int threadModule
    );

    public static string ReadPaths(string archivePath)
    {
        try
        {
            byte[] head = ReadHead(archivePath);
            int footerOffset = FindLxrsFooter(head);
            if (footerOffset < 0 || footerOffset + FooterHeaderSize > head.Length)
            {
                return "[]";
            }

            int rawSize = BitConverter.ToInt32(head, footerOffset + 8);
            int compressedSize = BitConverter.ToInt32(head, footerOffset + 12);
            int fileCount = BitConverter.ToInt32(head, footerOffset + 16);
            int payloadOffset = footerOffset + FooterHeaderSize;

            if (
                rawSize <= 0 ||
                compressedSize <= 0 ||
                fileCount <= 0 ||
                fileCount > 500000 ||
                payloadOffset + compressedSize > head.Length
            )
            {
                return "[]";
            }

            byte[] payload = new byte[compressedSize];
            Buffer.BlockCopy(head, payloadOffset, payload, 0, compressedSize);

            byte[] raw;
            if (rawSize > compressedSize)
            {
                raw = new byte[rawSize];
                int result = OodleLZDecompress(
                    payload,
                    payload.Length,
                    raw,
                    raw.Length,
                    1,
                    0,
                    0,
                    IntPtr.Zero,
                    0,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    0,
                    3
                );

                if (result <= 0)
                {
                    return "[]";
                }
            }
            else
            {
                raw = payload;
            }

            return ToJson(ReadNullTerminatedPaths(raw, fileCount));
        }
        catch
        {
            return "[]";
        }
    }

    private static byte[] ReadHead(string archivePath)
    {
        using (FileStream stream = File.OpenRead(archivePath))
        {
            int bytesToRead = (int)Math.Min(stream.Length, 2 * 1024 * 1024);
            byte[] head = new byte[bytesToRead];
            int read = stream.Read(head, 0, head.Length);
            if (read == head.Length)
            {
                return head;
            }

            byte[] trimmed = new byte[read];
            Buffer.BlockCopy(head, 0, trimmed, 0, read);
            return trimmed;
        }
    }

    private static int FindLxrsFooter(byte[] data)
    {
        for (int index = 0; index <= data.Length - 4; index++)
        {
            if (data[index] == 0x53 && data[index + 1] == 0x52 && data[index + 2] == 0x58 && data[index + 3] == 0x4C)
            {
                return index;
            }
        }

        return -1;
    }

    private static List<string> ReadNullTerminatedPaths(byte[] data, int fileCount)
    {
        Encoding encoding = Encoding.GetEncoding(28591);
        List<string> paths = new List<string>();
        int start = 0;

        for (int index = 0; index < data.Length && paths.Count < fileCount; index++)
        {
            if (data[index] != 0)
            {
                continue;
            }

            if (index > start)
            {
                paths.Add(encoding.GetString(data, start, index - start));
            }

            start = index + 1;
        }

        if (paths.Count < fileCount && start < data.Length)
        {
            paths.Add(encoding.GetString(data, start, data.Length - start));
        }

        return paths;
    }

    private static string ToJson(List<string> paths)
    {
        StringBuilder json = new StringBuilder();
        json.Append("[");

        for (int index = 0; index < paths.Count; index++)
        {
            if (index > 0)
            {
                json.Append(",");
            }

            json.Append("\"");
            json.Append(EscapeJson(paths[index]));
            json.Append("\"");
        }

        json.Append("]");
        return json.ToString();
    }

    private static string EscapeJson(string value)
    {
        StringBuilder escaped = new StringBuilder();

        foreach (char ch in value)
        {
            switch (ch)
            {
                case '\\':
                    escaped.Append("\\\\");
                    break;
                case '"':
                    escaped.Append("\\\"");
                    break;
                case '\b':
                    escaped.Append("\\b");
                    break;
                case '\f':
                    escaped.Append("\\f");
                    break;
                case '\n':
                    escaped.Append("\\n");
                    break;
                case '\r':
                    escaped.Append("\\r");
                    break;
                case '\t':
                    escaped.Append("\\t");
                    break;
                default:
                    if (ch < 32 || ch > 126)
                    {
                        escaped.Append("\\u");
                        escaped.Append(((int)ch).ToString("x4"));
                    }
                    else
                    {
                        escaped.Append(ch);
                    }
                    break;
            }
        }

        return escaped.ToString();
    }
}
"@

$source = $source.Replace('__OODLE_PATH__', $escapedOodlePath)
Add-Type -TypeDefinition $source -Language CSharp
[HyperionLxrsReader]::ReadPaths($ArchivePath)
