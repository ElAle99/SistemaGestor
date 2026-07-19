const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function printTicketText({ text, printerName = '', paper = '80mm', copies = 1, logoPath = '' }) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('La impresion directa solo esta disponible en Windows.'));
      return;
    }

    if (!text || !String(text).trim()) {
      reject(new Error('El ticket esta vacio.'));
      return;
    }

    const payload = JSON.stringify({
      text: String(text),
      printerName: String(printerName || ''),
      paper: ['58mm', '80mm'].includes(paper) ? paper : 'auto',
      copies: Math.max(1, Math.min(Number(copies) || 1, 3)),
      logoPath: String(logoPath || '')
    });

    const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { throw 'No se recibio informacion para imprimir.' }
$payload = $raw | ConvertFrom-Json
$ticketText = [string]$payload.text
if ([string]::IsNullOrWhiteSpace($ticketText)) { throw 'El ticket esta vacio.' }

$paper = [string]$payload.paper
$printerName = [string]$payload.printerName
$copies = 1
if ($payload.copies) { $copies = [Math]::Max(1, [Math]::Min([int]$payload.copies, 3)) }

Add-Type -AssemblyName System.Drawing
$widthMm = if ($paper -eq '58mm') { 58 } elseif ($paper -eq '80mm') { 80 } else { 80 }
$paperWidth = [int][Math]::Round(($widthMm / 25.4) * 100)
$paperHeight = 2400

for ($copy = 0; $copy -lt $copies; $copy++) {
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.DocumentName = 'AllFix Ticket'
  $doc.OriginAtMargins = $false

  if (-not [string]::IsNullOrWhiteSpace($printerName)) {
    $doc.PrinterSettings.PrinterName = $printerName
  }

  if (-not $doc.PrinterSettings.IsValid) {
    throw "La impresora no esta disponible: $printerName"
  }

  if ($paper -eq 'auto') {
    $detectedPaper = $doc.DefaultPageSettings.PaperSize
    if ($detectedPaper -and $detectedPaper.Width -gt 0) {
      $paperWidth = $detectedPaper.Width
      $widthMm = [Math]::Round(($paperWidth / 100) * 25.4, 1)
    }
  }

  $fontSize = if ($widthMm -le 65) { 7.0 } else { 8.5 }
  $font = New-Object System.Drawing.Font('Consolas', $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
  $brush = [System.Drawing.Brushes]::Black

  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("Ticket", $paperWidth, $paperHeight)

  $script:printText = $ticketText
  $script:printFont = $font
  $script:printBrush = $brush
  $script:logoPath = [string]$payload.logoPath
  $script:printWidthMm = $widthMm

  $doc.add_PrintPage({
    param($sender, $eventArgs)
    $eventArgs.Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
    $eventArgs.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    $pageWidth = [double]$eventArgs.PageBounds.Width
    $pageHeight = [double]$eventArgs.PageBounds.Height
    $topOffset = [double]0
    $hasLogo = (-not [string]::IsNullOrWhiteSpace($script:logoPath)) -and [System.IO.File]::Exists($script:logoPath)
    if ($hasLogo) {
      $img = $null
      try {
        $img = [System.Drawing.Image]::FromFile($script:logoPath)
        $paperLogoWidthLimit = if ([double]$script:printWidthMm -le 65) { [double]142 } else { [double]190 }
        $paperLogoHeightLimit = if ([double]$script:printWidthMm -le 65) { [double]52 } else { [double]70 }
        $maxLogoWidth = [double][Math]::Min([double]($pageWidth * 0.68), [double]$paperLogoWidthLimit)
        $maxLogoHeight = [double]$paperLogoHeightLimit
        $scaleByWidth = [double]($maxLogoWidth / [double]$img.Width)
        $scaleByHeight = [double]($maxLogoHeight / [double]$img.Height)
        $scale = [double][Math]::Min($scaleByWidth, $scaleByHeight)
        if ($scale -gt 1) { $scale = 1 }
        $drawWidth = [single][Math]::Max([double]1, [double]([double]$img.Width * $scale))
        $drawHeight = [single][Math]::Max([double]1, [double]([double]$img.Height * $scale))
        $drawX = [single](($pageWidth - [double]$drawWidth) / 2)
        $eventArgs.Graphics.DrawImage($img, $drawX, [single]4, $drawWidth, $drawHeight)
        $topOffset = [double]$drawHeight + 10
      } finally {
        if ($img) { $img.Dispose() }
      }
    }
    $textHeight = [single][Math]::Max([double]1, [double]($pageHeight - $topOffset))
    $bounds = New-Object System.Drawing.RectangleF([single]0, [single]$topOffset, [single]$pageWidth, $textHeight)
    $eventArgs.Graphics.DrawString($script:printText, $script:printFont, $script:printBrush, $bounds)
    $eventArgs.HasMorePages = $false
  })

  $doc.Print()
  $doc.Dispose()
  $font.Dispose()
}
`;

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout });
        return;
      }

      reject(new Error(stderr.trim() || `No se pudo imprimir el ticket. Codigo ${code}`));
    });

    child.stdin.write(payload, 'utf8');
    child.stdin.end();
  });
}

function normalizeImageData(imageData = '') {
  const raw = String(imageData || '').trim();
  const match = raw.match(/^data:(image\/(?:png|jpe?g));base64,(.+)$/i);

  if (match && match[1].toLowerCase() !== 'image/png') {
    throw new Error('El ticket debe enviarse como PNG para conservar la nitidez.');
  }

  const base64 = (match ? match[2] : raw).replace(/\s/g, '');

  if (!base64) {
    throw new Error('No se recibio imagen del ticket.');
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new Error('La imagen del ticket no es valida.');
  }

  return base64;
}

function printTicketImage({
  imageData,
  printerName = '',
  paper = '80mm',
  copies = 1,
  pixelWidth = 0,
  pixelHeight = 0,
  dpi = 203
}) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('La impresion directa solo esta disponible en Windows.'));
      return;
    }

    let workDir = '';
    let imagePath = '';

    try {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allfix-ticket-'));
      imagePath = path.join(workDir, 'ticket.png');
      fs.writeFileSync(imagePath, Buffer.from(normalizeImageData(imageData), 'base64'));
    } catch (error) {
      if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
      reject(error);
      return;
    }

    const payload = JSON.stringify({
      imagePath,
      printerName: String(printerName || ''),
      paper: ['58mm', '80mm'].includes(paper) ? paper : 'auto',
      copies: Math.max(1, Math.min(Number(copies) || 1, 3)),
      pixelWidth: Math.max(0, Number(pixelWidth) || 0),
      pixelHeight: Math.max(0, Number(pixelHeight) || 0),
      dpi: Math.max(180, Math.min(Number(dpi) || 203, 305))
    });

    const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { throw 'No se recibio informacion para imprimir.' }
$payload = $raw | ConvertFrom-Json
$imagePath = [string]$payload.imagePath
if ([string]::IsNullOrWhiteSpace($imagePath) -or -not [System.IO.File]::Exists($imagePath)) {
  throw 'No se encontro la imagen del ticket.'
}

$paper = [string]$payload.paper
$printerName = [string]$payload.printerName
$copies = 1
if ($payload.copies) { $copies = [Math]::Max(1, [Math]::Min([int]$payload.copies, 3)) }

Add-Type -AssemblyName System.Drawing
$thermalDpi = 203
if ($payload.dpi) { $thermalDpi = [Math]::Max(180, [Math]::Min([int]$payload.dpi, 305)) }
$ticketImage = [System.Drawing.Image]::FromFile($imagePath)
$pixelWidth = if ($payload.pixelWidth) { [int]$payload.pixelWidth } else { [int]$ticketImage.Width }
$pixelHeight = if ($payload.pixelHeight) { [int]$payload.pixelHeight } else { [int]$ticketImage.Height }
if ($pixelWidth -le 0) { $pixelWidth = if ($paper -eq '58mm') { 384 } else { 576 } }
if ($pixelHeight -le 0) { $pixelHeight = [int][Math]::Ceiling(([double]$ticketImage.Height * [double]$pixelWidth) / [double]$ticketImage.Width) }
$paperWidth = [int][Math]::Round(([double]$pixelWidth / [double]$thermalDpi) * 100)
$paperHeight = [int][Math]::Max(180, [Math]::Ceiling(([double]$pixelHeight / [double]$thermalDpi) * 100) + 2)

try {
  for ($copy = 0; $copy -lt $copies; $copy++) {
    $doc = New-Object System.Drawing.Printing.PrintDocument
    $doc.DocumentName = 'AllFix Ticket'
    $doc.OriginAtMargins = $false

    if (-not [string]::IsNullOrWhiteSpace($printerName)) {
      $doc.PrinterSettings.PrinterName = $printerName
    }

    if (-not $doc.PrinterSettings.IsValid) {
      throw "La impresora no esta disponible: $printerName"
    }

    $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
    $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Ticket', $paperWidth, $paperHeight)

    $script:printImage = $ticketImage
    $script:printPaperWidth = $paperWidth
    $script:printPaperHeight = $paperHeight

    $doc.add_PrintPage({
      param($sender, $eventArgs)
      $eventArgs.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Display
      $eventArgs.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
      $eventArgs.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
      $eventArgs.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
      $eventArgs.Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighSpeed
      $hardMarginX = [single]$eventArgs.PageSettings.HardMarginX
      $hardMarginY = [single]$eventArgs.PageSettings.HardMarginY
      $eventArgs.Graphics.TranslateTransform(-$hardMarginX, -$hardMarginY)
      $dest = New-Object System.Drawing.Rectangle(0, 0, $script:printPaperWidth, $script:printPaperHeight)
      $eventArgs.Graphics.DrawImage($script:printImage, $dest)
      $eventArgs.HasMorePages = $false
    })

    $doc.Print()
    $doc.Dispose()
  }
} finally {
  if ($ticketImage) { $ticketImage.Dispose() }
}
`;

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      fs.rmSync(workDir, { recursive: true, force: true });
      reject(error);
    });

    child.on('close', code => {
      fs.rmSync(workDir, { recursive: true, force: true });
      if (code === 0) {
        resolve({ stdout });
        return;
      }

      reject(new Error(stderr.trim() || `No se pudo imprimir el ticket. Codigo ${code}`));
    });

    child.stdin.write(payload, 'utf8');
    child.stdin.end();
  });
}

module.exports = {
  printTicketText,
  printTicketImage
};
