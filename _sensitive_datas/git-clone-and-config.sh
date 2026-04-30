#!/bin/bash
#
# Copyright (c) 2025 Ronan Le Meillat - SCTG Development
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

# =============================================================================
# Git Clone and Configure Script version 2.5
# =============================================================================
#
# Generalized script to clone a Git repository with a specific SSH key and configure GPG signing for commits.
# Usage: ./clone_and_config.sh <repo_url> <ssh_key_path> <gpg_key_id>
# Example: ./clone_and_config.sh git@github.com:user/repo.git ~/.ssh/id_ed25519_key ABCDEF1234567890ABCDEF1234567890ABCD

# Check arguments
if [ $# -ne 3 ]; then
    echo "Usage: $0 <repo_url> <ssh_key_path> <gpg_key_id>"
    exit 1
fi

REPO_URL=$1
SSH_KEY_PATH=$2
GPG_KEY_ID=$3

# Clone the repository using the specified SSH key
GIT_SSH_CORE_COMMAND="ssh -i $SSH_KEY_PATH -o IdentitiesOnly=yes"
GIT_SSH_COMMAND="$GIT_SSH_CORE_COMMAND" git clone $REPO_URL

# Extract the cloned directory name (based on the URL)
REPO_NAME=$(basename $REPO_URL .git)

# Change to the cloned directory
cd $REPO_NAME

# Extract the email from the GPG key (extract only the email part from the uid)
EMAIL=$(gpg --list-keys --with-colons $GPG_KEY_ID | grep '^uid:' | head -1 | cut -d: -f10 | sed 's/.*<\(.*\)>.*/\1/')

# Configure Git locally to use the GPG key for signing commits and set the user email
git config --local user.signingkey $GPG_KEY_ID
git config --local commit.gpgsign true
git config --local user.email "$EMAIL"
git config --local core.sshCommand "$GIT_SSH_CORE_COMMAND"

echo "Repository cloned and configured successfully."
