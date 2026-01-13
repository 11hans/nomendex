#!/bin/bash

# Remove Noetect from Applications and user data

echo "Removing Noetect from /Applications..."
rm -rf /Applications/Noetect.app

echo "Removing user data from ~/Library/Application Support..."
rm -rf ~/Library/Application\ Support/com.firstloop.noetect

echo "Done! Noetect and all user data have been removed."
