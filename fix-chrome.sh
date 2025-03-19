#!/bin/bash

# This script installs Chrome in a Docker container if it's not already installed
# It's used as a helper for the html-to-pdf-action Docker image

# Check if Chrome is installed
if [ ! -f "/usr/bin/google-chrome" ]; then
  echo "Chrome not found, installing..."
  
  # Install Chrome
  apt-get update
  apt-get install -y wget gnupg
  wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -
  sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list'
  apt-get update
  apt-get install -y google-chrome-stable
  apt-get clean
  rm -rf /var/lib/apt/lists/*
  
  echo "Chrome installed successfully"
else
  echo "Chrome is already installed"
fi

# Display Chrome version
google-chrome --version

# Set environment variable for Puppeteer
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome