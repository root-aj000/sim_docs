# =============================
# Git Commit & Push (New + Modified Files) with LFS + Appendable Logging
# =============================

# --- CONFIG ---
$branch = "master"              # Change to 'main' if needed
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
Log "`n=== Starting Git Commit & Push for All Changes ===`n"

# --- CHECK GIT REPO ---
if (-not (Test-Path ".git")) {
    Log "Not a Git repository. Please run this script from the repo root."
    exit
}

# --- INITIALIZE LFS ---
git lfs install | Out-Null

# --- GATHER FILES ---
$untracked = git ls-files -o --exclude-standard
$modified = git ls-files -m
$deleted = git ls-files -d

if (-not $untracked -and -not $modified -and -not $deleted) {
    Log "No changes found to commit."
    exit
}

# --- PROCESS UNTRACKED FILES ---
foreach ($file in $untracked) {
    $fullPath = Join-Path (Get-Location) $file
    if (-not (Test-Path $fullPath)) { continue }

    $fileSizeMB = [math]::Round((Get-Item $fullPath).Length / 1MB, 2)

    if ($fileSizeMB -gt $maxFileSizeMB) {
        git lfs track "$file" | Out-Null
        Add-Content -Path $largeFilesLog -Value "$file ($fileSizeMB MB)"
        Log "Skipped large file (LFS tracked): $file (${fileSizeMB} MB)"
        continue
    }

    git add -- "$file"
    $commitMessage = "Add new file: $file"
    git commit -m "$commitMessage" | Out-Null
    Log "Committed new file: $file"
}

# --- PROCESS MODIFIED FILES ---
foreach ($file in $modified) {
    if (-not (Test-Path $file)) { continue }

    $fileSizeMB = [math]::Round((Get-Item $file).Length / 1MB, 2)
    if ($fileSizeMB -gt $maxFileSizeMB) {
        git lfs track "$file" | Out-Null
        Add-Content -Path $largeFilesLog -Value "$file ($fileSizeMB MB)"
        Log "Skipped modified large file (LFS tracked): $file (${fileSizeMB} MB)"
        continue
    }

    git add -- "$file"
    $commitMessage = "Update modified file: $file"
    git commit -m "$commitMessage" | Out-Null
    Log "Committed modified file: $file"
}

# --- HANDLE DELETED FILES ---
foreach ($file in $deleted) {
    git rm "$file" | Out-Null
    $commitMessage = "Remove deleted file: $file"
    git commit -m "$commitMessage" | Out-Null
    Log "Committed file deletion: $file"
}

# --- PUSH ALL COMMITS ---
Log "Pushing all commits to $remote/$branch ..."
git push -u $remote $branch | Out-Null
Log "Push completed successfully."

# --- COMMIT AND PUSH LFS ATTRIBUTES ---
if (Test-Path ".gitattributes") {
    git add .gitattributes | Out-Null
    git commit -m "Add/Update Git LFS attributes" | Out-Null
    git push -u $remote $branch | Out-Null
    Log ".gitattributes committed and pushed."
}

# --- FINAL LOG ---
Log "`nAll new and modified files processed."
Log "Large files tracked in $largeFilesLog."
Log "`n=== Git Push Complete ===`n"
