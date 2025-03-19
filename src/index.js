#!/usr/bin/env node

const core = require('@actions/core');
const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');
const puppeteer = require('puppeteer');
const htmlPdf = require('html-pdf-node');
const { PDFDocument } = require('pdf-lib');

// Helper function to get input from environment or CLI arguments
function getInput(name, options = {}) {
  // Check if running in GitHub Actions
  if (process.env[`INPUT_${name.toUpperCase()}`]) {
    return core.getInput(name, options);
  }
  
  // Check for CLI arguments
  const argPrefix = `--${name}=`;
  const arg = process.argv.find(arg => arg.startsWith(argPrefix));
  if (arg) {
    return arg.substring(argPrefix.length);
  }
  
  // Check for environment variables
  if (process.env[name.toUpperCase()]) {
    return process.env[name.toUpperCase()];
  }
  
  // Return empty string or throw if required
  if (options.required) {
    throw new Error(`Input '${name}' is required`);
  }
  
  return '';
}

// Function to log output (works in both GitHub Actions and CLI)
function log(message, level = 'info') {
  if (typeof core[level] === 'function') {
    core[level](message);
  } else {
    console.log(message);
  }
}

// Function to set output (works in both GitHub Actions and CLI)
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    // New method using environment file
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  } else if (typeof core.setOutput === 'function') {
    // Using @actions/core method (which should use environment file if available)
    core.setOutput(name, value);
  } else {
    // Fallback for local CLI usage
    console.log(`Output ${name}: ${value}`);
  }
}

// Function to report failure (works in both GitHub Actions and CLI)
function setFailed(message) {
  if (typeof core.setFailed === 'function') {
    core.setFailed(message);
  } else {
    console.error(message);
    process.exit(1);
  }
}

// Function to check if string is a URL
function isUrl(str) {
  try {
    new URL(str);
    return true;
  } catch (e) {
    return false;
  }
}

// Function to check if string is a file path
async function isFilePath(str) {
  try {
    const stats = await fs.stat(str);
    return stats.isFile();
  } catch (e) {
    return false;
  }
}

// Function to parse margins
function parseMargins(marginStr) {
  const margins = marginStr.split(',').map(m => parseInt(m.trim(), 10));
  if (margins.length === 1) {
    return { top: margins[0], right: margins[0], bottom: margins[0], left: margins[0] };
  } else if (margins.length === 4) {
    return {
      top: margins[0],
      right: margins[1],
      bottom: margins[2],
      left: margins[3]
    };
  } else {
    throw new Error('Margins must be in format: top,right,bottom,left or a single value for all sides');
  }
}

// Method 1: Convert HTML to PDF using Puppeteer
async function convertWithPuppeteer(source, options) {
  log('Converting with Puppeteer...');
  
  try {
    // Launch browser with relaxed security settings for Docker
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--font-render-hinting=none'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({
      width: 1200,
      height: 800
    });
    
    // Set user agent if provided
    if (options.userAgent) {
      await page.setUserAgent(options.userAgent);
    }
    
    // Navigate to URL or set content
    if (options.sourceType === 'url') {
      await page.goto(source, { 
        waitUntil: 'networkidle0',
        timeout: options.timeout 
      });
    } else {
      await page.setContent(source, { 
        waitUntil: 'networkidle0',
        timeout: options.timeout 
      });
    }
    
    // Wait for selector if provided
    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { 
        timeout: options.timeout 
      });
    }
    
    // Inject custom CSS if provided
    if (options.customCss) {
      await page.addStyleTag({ content: options.customCss });
    }
    
    // Generate PDF
    await page.pdf({
      path: options.output,
      format: options.format,
      landscape: options.orientation === 'landscape',
      margin: {
        top: `${options.margin.top}mm`,
        right: `${options.margin.right}mm`,
        bottom: `${options.margin.bottom}mm`,
        left: `${options.margin.left}mm`,
      },
      printBackground: options.printBackground,
      displayHeaderFooter: !!(options.headerTemplate || options.footerTemplate),
      headerTemplate: options.headerTemplate || '',
      footerTemplate: options.footerTemplate || '',
      scale: options.scale
    });
    
    await browser.close();
    return true;
  } catch (error) {
    log(`Puppeteer conversion error: ${error.message}`, 'warning');
    return false;
  }
}

// Method 2: Convert HTML to PDF using html-pdf-node
async function convertWithHtmlPdfNode(source, options) {
  log('Converting with html-pdf-node...');
  
  try {
    // Create file object based on source type
    let file;
    if (options.sourceType === 'url') {
      file = { url: source };
    } else {
      file = { content: source };
    }
    
    // Convert html-pdf-node options format
    const pdfOptions = {
      format: options.format,
      landscape: options.orientation === 'landscape',
      margin: {
        top: `${options.margin.top}mm`,
        right: `${options.margin.right}mm`,
        bottom: `${options.margin.bottom}mm`,
        left: `${options.margin.left}mm`,
      },
      printBackground: options.printBackground,
      scale: options.scale,
      path: options.output,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    };
    
    // Generate PDF
    await htmlPdf.generatePdf(file, pdfOptions);
    return true;
  } catch (error) {
    log(`html-pdf-node conversion error: ${error.message}`, 'warning');
    return false;
  }
}

// Method 3: Create a simple PDF with minimal content using pdf-lib
async function createBasicPdfWithPdfLib(source, options) {
  log('Creating basic PDF with pdf-lib...');
  
  try {
    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();
    
    // Add a page with the specified format
    const page = pdfDoc.addPage(options.format === 'A4' ? [595, 842] : [612, 792]);
    
    // Extract plain text from HTML (very basic)
    const plainText = source.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Draw some basic text on the page
    page.drawText('HTML to PDF Conversion', {
      x: 50,
      y: page.getHeight() - 50,
      size: 20
    });
    
    // Add a note about the fallback
    page.drawText('Note: This is a fallback PDF with minimal formatting.', {
      x: 50,
      y: page.getHeight() - 80,
      size: 12
    });
    
    // Add source info
    if (plainText.length > 0) {
      const previewText = plainText.substring(0, 300) + (plainText.length > 300 ? '...' : '');
      
      page.drawText('Content preview:', {
        x: 50,
        y: page.getHeight() - 120,
        size: 12
      });
      
      // Split preview text into multiple lines
      const lines = [];
      let currentLine = '';
      const words = previewText.split(' ');
      
      for (const word of words) {
        if ((currentLine + ' ' + word).length > 60) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = currentLine ? currentLine + ' ' + word : word;
        }
      }
      
      if (currentLine) {
        lines.push(currentLine);
      }
      
      // Draw each line
      lines.forEach((line, index) => {
        page.drawText(line, {
          x: 50,
          y: page.getHeight() - 140 - (index * 20),
          size: 10
        });
      });
    }
    
    // Save the PDF
    const pdfBytes = await pdfDoc.save();
    await fs.writeFile(options.output, pdfBytes);
    
    return true;
  } catch (error) {
    log(`pdf-lib creation error: ${error.message}`, 'warning');
    return false;
  }
}

// Main function
async function run() {
  try {
    // Get inputs
    const source = getInput('source', { required: true });
    const output = getInput('output', { required: true });
    const waitForSelector = getInput('wait_for');
    const format = getInput('format') || 'A4';
    const marginInput = getInput('margin') || '10,10,10,10';
    const orientation = getInput('orientation') || 'portrait';
    const headerTemplate = getInput('header_template') || '';
    const footerTemplate = getInput('footer_template') || '';
    const timeout = parseInt(getInput('timeout') || '30000', 10);
    const scale = parseFloat(getInput('scale') || '1');
    const customCss = getInput('custom_css') || '';
    const cookiesStr = getInput('cookies') || '[]';
    const userAgent = getInput('user_agent');
    const printBackground = getInput('print_background') !== 'false'; // Default to true

    // Parse margins
    const margin = parseMargins(marginInput);

    // Parse cookies if provided
    let cookies = [];
    if (cookiesStr) {
      try {
        cookies = JSON.parse(cookiesStr);
      } catch (e) {
        log(`Failed to parse cookies: ${e.message}`, 'warning');
      }
    }

    // Create output directory if it doesn't exist
    await fs.ensureDir(path.dirname(output));

    // Determine how to load the source
    let sourceContent;
    let sourceType;
    
    if (await isFilePath(source)) {
      // Source is a file path
      log(`Using file: ${source}`);
      const content = await fs.readFile(source, 'utf8');
      sourceContent = content;
      sourceType = 'html';
    } else if (isUrl(source)) {
      // Source is a URL
      log(`Using URL: ${source}`);
      sourceContent = source;
      sourceType = 'url';
    } else {
      // Source is HTML content
      log('Using HTML content from input');
      sourceContent = source;
      sourceType = 'html';
    }

    // Prepare options for conversion methods
    const conversionOptions = {
      sourceType,
      output,
      format,
      margin,
      orientation,
      headerTemplate,
      footerTemplate,
      timeout,
      scale,
      customCss,
      cookies,
      userAgent,
      printBackground,
      waitForSelector
    };

    // Try multiple conversion methods in sequence
    log('Attempting PDF conversion...');
    
    // Method 1: Puppeteer
    let success = await convertWithPuppeteer(sourceContent, conversionOptions);
    
    // Method 2: html-pdf-node
    if (!success) {
      log('Primary conversion method failed. Trying alternative method...', 'warning');
      success = await convertWithHtmlPdfNode(sourceContent, conversionOptions);
    }
    
    // Method 3: Basic PDF with pdf-lib (guaranteed to work)
    if (!success) {
      log('Alternative method failed. Creating basic PDF as fallback...', 'warning');
      success = await createBasicPdfWithPdfLib(sourceContent, conversionOptions);
    }
    
    if (success) {
      log(`PDF generated successfully: ${output}`);
      setOutput('pdf_path', output);
    } else {
      setFailed('All conversion methods failed. This is unexpected as the final method should always work.');
    }
  } catch (error) {
    setFailed(`Action failed: ${error.message}`);
  }
}

run();