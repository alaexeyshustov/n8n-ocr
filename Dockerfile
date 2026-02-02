FROM n8nio/n8n:latest

# Copy workflow files into the container
# n8n stores workflows in /home/node/.n8n/
COPY --chown=node:node workflows/ /home/node/.n8n/

# Ensure proper permissions
USER root
RUN chown -R node:node /home/node/.n8n
USER node
