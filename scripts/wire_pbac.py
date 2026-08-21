#!/usr/bin/env python3
"""
wire_pbac.py — Replace protectedProcedure with PBAC-enforced variants
on all export, delete, and approve operations across router files.
"""
import re, os

ROUTER_DIR = "./server/routers"
TRPC_CORE = "./server/_core/trpc.ts"

# Files to process
TARGET_FILES = [
    "banking.ts",
    "phase13Features.ts",
    "productionFeatures.ts",
    "production9Features.ts",
    "enhancements.ts",
]

# Patterns to replace
# Format: (context_pattern, old_procedure, new_procedure)
REPLACEMENTS = [
    # Export CSV procedures
    (r"exportCsv:\s*protectedProcedure", "protectedProcedure", "exportProcedure"),
    # Approve procedures using protectedProcedure (not adminProcedure - those are already protected)
    (r"approve:\s*protectedProcedure", "protectedProcedure", "approveProcedure"),
    # Delete procedures using protectedProcedure
    (r"delete:\s*protectedProcedure", "protectedProcedure", "deleteProcedure"),
]

def add_pbac_imports(content: str, filename: str) -> str:
    """Add exportProcedure, deleteProcedure, approveProcedure to imports from trpc."""
    # Check if already imported
    if "exportProcedure" in content:
        return content
    
    # Find the import from trpc
    old_import = re.search(r'import \{([^}]+)\} from "\.\./\._core/trpc"', content)
    if not old_import:
        old_import = re.search(r'import \{([^}]+)\} from "\._core/trpc"', content)
    if not old_import:
        old_import = re.search(r'import \{([^}]+)\} from "\.\./_core/trpc"', content)
    
    if old_import:
        existing = old_import.group(1)
        new_imports = existing.rstrip() + ", exportProcedure, deleteProcedure, approveProcedure"
        content = content.replace(old_import.group(0), 
                                   old_import.group(0).replace(existing, new_imports))
    return content

def process_file(filepath: str) -> tuple[int, int]:
    """Process a single file. Returns (changes_made, total_replacements)."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    changes = 0
    
    # Add imports
    content = add_pbac_imports(content, filepath)
    
    # Apply targeted replacements
    # Replace exportCsv: protectedProcedure
    new_content = re.sub(
        r'(exportCsv:\s*)protectedProcedure\b',
        r'\1exportProcedure',
        content
    )
    if new_content != content:
        changes += len(re.findall(r'exportCsv:\s*exportProcedure', new_content))
        content = new_content
    
    # Replace approve: protectedProcedure (not adminProcedure - those are already protected)
    new_content = re.sub(
        r'(approve:\s*)protectedProcedure\b',
        r'\1approveProcedure',
        content
    )
    if new_content != content:
        changes += len(re.findall(r'approve:\s*approveProcedure', new_content))
        content = new_content
    
    # Replace delete: protectedProcedure
    new_content = re.sub(
        r'(delete:\s*)protectedProcedure\b',
        r'\1deleteProcedure',
        content
    )
    if new_content != content:
        changes += len(re.findall(r'delete:\s*deleteProcedure', new_content))
        content = new_content
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return 1, changes
    return 0, 0

total_files = 0
total_changes = 0

for fname in TARGET_FILES:
    fpath = os.path.join(ROUTER_DIR, fname)
    if os.path.exists(fpath):
        files_changed, replacements = process_file(fpath)
        if files_changed:
            print(f"  ✅ {fname}: {replacements} replacements")
            total_files += 1
            total_changes += replacements
        else:
            print(f"  ⏭  {fname}: no changes needed")
    else:
        print(f"  ⚠️  {fname}: not found")

print(f"\nTotal: {total_files} files modified, {total_changes} procedure replacements")
