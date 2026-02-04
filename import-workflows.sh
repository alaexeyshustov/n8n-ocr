#!/bin/sh
# Workflow Import Script for n8n Container
# This script runs on container startup to import workflows from /data/workflows-import/
# into the EFS-backed /home/node/.n8n/ directory on first run only.

if [ ! -f /home/node/.n8n/.workflows-imported ]; then
  echo "Importing workflows..."
  for workflow in /data/workflows-import/*.json; do
    if [ -f "$workflow" ]; then
      echo "Importing $(basename $workflow)"
      cp "$workflow" /home/node/.n8n/$(basename $workflow)
    fi
  done
  touch /home/node/.n8n/.workflows-imported
  echo "Workflows imported successfully"
else
  echo "Workflows already imported, skipping..."
fi
