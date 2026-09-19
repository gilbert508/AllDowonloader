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

# Launch using Gunicorn binding to Render's dynamic PORT variable
CMD ["sh", "-c", "gunicorn -b 0.0.0.0:${PORT:-10000} -w 2 --timeout 300 server:app"]
