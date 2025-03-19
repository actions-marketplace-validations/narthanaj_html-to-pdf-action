#!/usr/bin/env node

const core = require('@actions/core');
const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');
const axios = require('axios');
const { chromium } = require('playwright');

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

// Function to convert HTML to PDF using Playwright
async function convertWithPlaywright(sourceContent, sourceType, options) {
  log('Converting with Playwright...');
  
  let browser;
  try {
    // Launch browser with minimal options to ensure it works in Docker
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Set cookies if provided
    if (options.cookies && options.cookies.length > 0) {
      if (sourceType === 'url') {
        const url = new URL(sourceContent);
        for (const cookie of options.cookies) {
          await context.addCookies([{
            ...cookie,
            domain: cookie.domain || url.hostname,
            path: cookie.path || '/'
          }]);
        }
      }
    }
    
    // Set user agent if provided
    if (options.userAgent) {
      await page.setExtraHTTPHeaders({
        'User-Agent': options.userAgent
      });
    }
    
    // Navigate to URL or set content
    if (sourceType === 'url') {
      await page.goto(sourceContent, { waitUntil: 'networkidle', timeout: options.timeout });
    } else {
      await page.setContent(sourceContent, { waitUntil: 'networkidle', timeout: options.timeout });
    }
    
    // Wait for selector if provided
    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: options.timeout });
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
      margin: options.margin,
      printBackground: options.printBackground,
      displayHeaderFooter: !!(options.headerTemplate || options.footerTemplate),
      headerTemplate: options.headerTemplate || '',
      footerTemplate: options.footerTemplate || '',
      scale: options.scale
    });
    
    await browser.close();
    return true;
  } catch (error) {
    if (browser) {
      await browser.close();
    }
    log(`Playwright conversion error: ${error.message}`, 'warning');
    return false;
  }
}

// Fallback method using wkhtmltopdf CLI if available
async function convertWithWkhtmltopdf(sourceContent, sourceType, options) {
  return new Promise((resolve) => {
    log('Attempting conversion with wkhtmltopdf...');
    
    try {
      // Check if wkhtmltopdf is installed
      const checkProcess = spawn('which', ['wkhtmltopdf']);
      checkProcess.on('close', (code) => {
        if (code !== 0) {
          log('wkhtmltopdf not found, skipping this method', 'warning');
          resolve(false);
          return;
        }
        
        // Prepare wkhtmltopdf arguments
        const args = [
          '--enable-local-file-access',
          '--disable-smart-shrinking',
          '--quiet'
        ];
        
        // Add margin options
        if (options.margin) {
          args.push(`--margin-top`, `${options.margin.top}mm`);
          args.push(`--margin-right`, `${options.margin.right}mm`);
          args.push(`--margin-bottom`, `${options.margin.bottom}mm`);
          args.push(`--margin-left`, `${options.margin.left}mm`);
        }
        
        // Add page size
        if (options.format) {
          args.push(`--page-size`, options.format);
        }
        
        // Add orientation
        if (options.orientation === 'landscape') {
          args.push(`--orientation`, 'Landscape');
        } else {
          args.push(`--orientation`, 'Portrait');
        }
        
        // Add background option
        if (options.printBackground) {
          args.push('--background');
        }
        
        // Add scale factor
        if (options.scale && options.scale !== 1) {
          args.push(`--zoom`, options.scale.toString());
        }
        
        // Add header and footer
        if (options.headerTemplate) {
          const headerPath = path.join(path.dirname(options.output), 'header.html');
          fs.writeFileSync(headerPath, options.headerTemplate);
          args.push('--header-html', headerPath);
        }
        
        if (options.footerTemplate) {
          const footerPath = path.join(path.dirname(options.output), 'footer.html');
          fs.writeFileSync(footerPath, options.footerTemplate);
          args.push('--footer-html', footerPath);
        }
        
        // Add user agent
        if (options.userAgent) {
          args.push('--user-style-sheet', options.userAgent);
        }
        
        // Add timeout
        if (options.timeout) {
          args.push('--javascript-delay', Math.floor(options.timeout / 1000).toString());
        }
        
        // Add source and output
        if (sourceType === 'url') {
          args.push(sourceContent);
        } else if (sourceType === 'file') {
          args.push(sourceContent);
        } else {
          // Content is HTML string, write to temp file
          const tmpHtmlPath = path.join(path.dirname(options.output), 'temp.html');
          fs.writeFileSync(tmpHtmlPath, sourceContent);
          args.push(tmpHtmlPath);
        }
        
        args.push(options.output);
        
        // Run wkhtmltopdf
        const wkProcess = spawn('wkhtmltopdf', args);
        
        wkProcess.stderr.on('data', (data) => {
          log(`wkhtmltopdf warning: ${data}`, 'warning');
        });
        
        wkProcess.on('close', (code) => {
          if (code === 0) {
            log('Successfully converted with wkhtmltopdf');
            resolve(true);
          } else {
            log(`wkhtmltopdf failed with code ${code}`, 'warning');
            resolve(false);
          }
        });
      });
    } catch (error) {
      log(`wkhtmltopdf error: ${error.message}`, 'warning');
      resolve(false);
    }
  });
}

// Alternative conversion method using a PDF conversion service (as a last resort)
async function convertWithApiService(sourceContent, sourceType, options) {
  // This is a placeholder for potential API service integration
  // It would be a fallback option if all other methods fail
  log('API-based conversion not implemented yet. Consider installing wkhtmltopdf in your container.', 'warning');
  return false;
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
      sourceContent = source;
      sourceType = 'file';
      log(`Using file: ${source}`);
    } else if (isUrl(source)) {
      // Source is a URL
      sourceContent = source;
      sourceType = 'url';
      log(`Using URL: ${source}`);
    } else {
      // Source is HTML content
      sourceContent = source;
      sourceType = 'html';
      log('Using HTML content from input');
    }
    
    // If source type is file, read the content
    if (sourceType === 'file') {
      sourceContent = await fs.readFile(source, 'utf8');
      sourceType = 'html';
    }

    // Prepare options for conversion methods
    const conversionOptions = {
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

    // Try Playwright first (most reliable)
    log('Attempting PDF conversion...');
    let success = await convertWithPlaywright(sourceContent, sourceType, conversionOptions);
    
    // If Playwright fails, try wkhtmltopdf
    if (!success) {
      log('Primary conversion method failed. Trying alternative method...', 'warning');
      success = await convertWithWkhtmltopdf(sourceContent, sourceType, conversionOptions);
    }
    
    // If both methods fail, try API service as last resort
    if (!success) {
      log('Alternative method failed. Trying last resort method...', 'warning');
      success = await convertWithApiService(sourceContent, sourceType, conversionOptions);
    }
    
    if (success) {
      log(`PDF generated successfully: ${output}`);
      setOutput('pdf_path', output);
    } else {
      setFailed('All conversion methods failed. Please ensure your HTML is valid and try installing wkhtmltopdf.');
    }
  } catch (error) {
    setFailed(`Action failed: ${error.message}`);
  }
}

run();