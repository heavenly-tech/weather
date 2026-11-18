# Orchestrator image. Build it on omarchibald or the Mac mini, not on heavenly.
# WRF itself stays in the prepared ncar/iwrf image. This image only runs the cycle.

FROM alpine:3
RUN apk add --no-cache python3 bash coreutils util-linux
WORKDIR /opt/wrf
COPY scripts/wrf /opt/wrf
COPY config/wrf /opt/wrf/config
USER 65534:65534
ENTRYPOINT ["python3", "/opt/wrf/orchestrate.py"]
