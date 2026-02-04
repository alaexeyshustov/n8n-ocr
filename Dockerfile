# Stage 1: Get Python from official Alpine image
FROM python:3.12-alpine AS python-base

# Stage 2: Build final n8n image
FROM n8nio/n8n:latest

# Copy Python from the python-base stage
USER root

# Copy Python executable and pip
COPY --from=python-base /usr/local/bin/python3 /usr/local/bin/python3
COPY --from=python-base /usr/local/bin/pip3 /usr/local/bin/pip3
COPY --from=python-base /usr/local/bin/python3.12 /usr/local/bin/python3.12

# Copy Python libraries
COPY --from=python-base /usr/local/lib/python3.12 /usr/local/lib/python3.12

# Copy shared libraries that Python depends on
COPY --from=python-base /usr/local/lib/libpython3.12.so.1.0 /usr/local/lib/libpython3.12.so.1.0

# Create symlinks for Python and pip
RUN ln -sf /usr/local/bin/python3 /usr/local/bin/python && \
    ln -sf /usr/local/bin/pip3 /usr/local/bin/pip && \
    ln -sf /usr/local/lib/libpython3.12.so.1.0 /usr/local/lib/libpython3.12.so && \
    ln -sf /usr/local/lib/libpython3.12.so.1.0 /usr/local/lib/libpython3.so

# Copy workflow files to a directory that won't be overridden by EFS mount
# The /data directory is typically used for static assets in n8n
COPY --chown=node:node workflows/ /data/workflows-import/

# Copy workflow import script
COPY import-workflows.sh /usr/local/bin/import-workflows.sh
RUN chmod +x /usr/local/bin/import-workflows.sh

# Set environment variable to run import script before n8n starts
ENV N8N_CUSTOM_EXTENSIONS="/data"

USER node

# Override entrypoint to run import script before starting n8n
ENTRYPOINT ["/bin/sh", "-c", "/usr/local/bin/import-workflows.sh && exec /docker-entrypoint.sh"]

