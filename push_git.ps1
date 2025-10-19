# =============================
# Git Single-File Commit & Push with LFS and Appendable Logging
# =============================

# --- CONFIG ---
$branch = "master"              # Branch name (change to 'main' if needed)
$remote = "origin"              # Remote name
$maxFileSizeMB = 100            # Skip files larger than this (GitHub limit)
$largeFilesLog = "large_files.txt"
$fullLogFile = "git_push_log.txt"

# --- HELPER FUNCTION ---
function Log($message) {
    Write-Host $message
    Add-Content -Path $fullLogFile -Value $message
}

# --- INITIAL LOG ---
Log "`n=== Starting single-file Git commits ===`n"

# --- CHECK GIT REPO ---
if (-not (Test-Path ".git")) {
    Log "Not a Git repository. Please run this script from the repo root."
    exit
}

# --- INITIALIZE LFS ---
git lfs install | Out-Null

# --- GET ALL NON-IGNORED FILES ---
$allFiles = git ls-files -o --exclude-standard
if (-not $allFiles) {
    Log "No non-ignored files found to commit."
    exit
}

# --- PROCESS FILES ---
foreach ($file in $allFiles) {
    $fullPath = Join-Path (Get-Location) $file
    $fileSizeMB = [math]::Round((Get-Item $fullPath).Length / 1MB, 2)

    if ($fileSizeMB -gt $maxFileSizeMB) {
        # Track with Git LFS
        git lfs track "$file" | Out-Null
        Add-Content -Path $largeFilesLog -Value "$file ($fileSizeMB MB)"
        Log "Skipping large file (tracked by LFS): $file ($fileSizeMB MB)"
        continue
    }

    # Stage file
    git add -- $file

    # Commit
    $commitMessage = "update $file"
    git commit -m "$commitMessage" | Out-Null

    # Push
    Log "Pushing $file to $remote/$branch ..."
    git push -u $remote $branch | Out-Null
    Log "$file pushed successfully."
}

# --- COMMIT AND PUSH .gitattributes CREATED BY LFS ---
if (Test-Path ".gitattributes") {
    git add .gitattributes | Out-Null
    git commit -m "Add Git LFS attributes" | Out-Null
    git push -u $remote $branch | Out-Null
    Log ".gitattributes committed and pushed."
}

Log "`nAll non-ignored files processed. Large files logged in $largeFilesLog."
Log "`n=== Git push completed ===`n"
