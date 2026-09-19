FROM python:3.10-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Run gunicorn via python module flag
CMD ["sh", "-c", "python -m gunicorn -b 0.0.0.0:${PORT:-10000} -w 1 --timeout 300 server:app"]
