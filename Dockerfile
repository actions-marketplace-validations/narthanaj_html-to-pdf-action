FROM node:22-slim

# Install dependencies for wkhtmltopdf and Chrome
RUN apt-get update && apt-get install -y \
    wget \
    fontconfig \
    libfreetype6 \
    libjpeg62-turbo \
    libpng16-16 \
    libx11-6 \
    libxcb1 \
    libxext6 \
    libxrender1 \
    xfonts-75dpi \
    xfonts-base \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-kacst \
    fonts-freefont-ttf \
    ca-certificates \
    gnupg \
    --no-install-recommends

# Install wkhtmltopdf
RUN wget -q https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6.1-2/wkhtmltox_0.12.6.1-2.bullseye_amd64.deb && \
    dpkg -i wkhtmltox_0.12.6.1-2.bullseye_amd64.deb || true && \
    apt-get -f install -y && \
    rm wkhtmltox_0.12.6.1-2.bullseye_amd64.deb

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src /app/src

# Make index.js executable
RUN chmod +x /app/src/index.js

# Install Playwright browsers
RUN npx playwright install chromium --with-deps

# Set environment variable for Playwright to prevent timeout issues
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Create a directory for temporary files
RUN mkdir -p /tmp/html-to-pdf

# Set the entrypoint
ENTRYPOINT ["node", "/app/src/index.js"]