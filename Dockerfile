FROM n8nio/n8n:latest

# Install Python for n8n code nodes
USER root
RUN apk add --update --no-cache python3 py3-pip

# Copy workflow files into the container
# n8n stores workflows in /home/node/.n8n/
COPY --chown=node:node workflows/ /home/node/.n8n/

# Ensure proper permissions
RUN chown -R node:node /home/node/.n8n

USER node
