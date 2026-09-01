FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV YOLO_CONFIG_DIR=/tmp/ultralytics

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /worker

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --no-deps ultralytics==8.4.115

COPY analyze_climb_video.py live_stream_worker.py worker_healthcheck.py ./
COPY worker-defaults.json ./worker-defaults.json
COPY models/yolo11n-pose.pt ./models/yolo11n-pose.pt

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=4 \
    CMD ["python", "worker_healthcheck.py", "output/live-worker/status.json"]

CMD ["python", "live_stream_worker.py", "--output", "output/live-worker"]
