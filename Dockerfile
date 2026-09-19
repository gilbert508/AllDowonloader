FROM python:3.10-slim

# Install FFmpeg and system tools
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Run with Gunicorn on port 10000
EXPOSE 10000
CMD ["gunicorn", "-b", "0.0.0.0:10000", "-w", "2", "--timeout", "300", "server:app"]