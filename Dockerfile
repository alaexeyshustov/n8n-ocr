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

# Create symlinks
RUN ln -sf /usr/local/bin/python3 /usr/local/bin/python && \
    ln -sf /usr/local/bin/pip3 /usr/local/bin/pip

# Copy workflow files into the container
# n8n stores workflows in /home/node/.n8n/
COPY --chown=node:node workflows/ /home/node/.n8n/

# Ensure proper permissions
RUN chown -R node:node /home/node/.n8n

USER node
