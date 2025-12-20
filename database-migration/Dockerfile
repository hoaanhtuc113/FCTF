# Use Python 3.11 slim image for smaller size
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies required for PyMySQL and cryptography
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY config.py .
COPY main.py .
COPY migrator.py .
COPY mapping_fctf_to_ctfd.json .
COPY mapping_ctfd_to_fctf.json .

# Copy .env if exists (optional, better to use docker environment variables)


# Make main.py executable
RUN chmod +x main.py

# Keep container running and allow interactive shell
CMD ["/bin/bash"]
