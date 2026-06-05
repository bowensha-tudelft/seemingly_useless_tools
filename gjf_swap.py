#!/usr/bin/env python3
"""
gjf_swap.py - Read a Gaussian .gjf file, display molecular formula and atom count,
reorder selected atoms to the top or bottom of the coordinate list.

Usage:
  python gjf_swap.py -f input.gjf [-o output.gjf] -atoms 1,3-5 (-t | -b) [-v]

Options:
  -f FILE       Input .gjf file
  -o FILE       Output .gjf file (default: overwrite input file)
  -atoms SPEC   Atom indices, comma/dash-separated (e.g., 1,3-5,7)
  -t            Move selected atoms to the TOP
  -b            Move selected atoms to the BOTTOM
  -v            Verbose: print atom list to screen
  -h, --help    Show this help message

If no flags are given, runs in interactive mode.
"""

import sys
import re
import os
from collections import Counter


# ──────────────────────────────────────────────
#  Core functions
# ──────────────────────────────────────────────

def parse_gjf(filepath):
    """Parse a .gjf file and return its structural components.

    Returns a dict with keys:
        header_lines  - lines before the charge/spin line (%, #, title, blanks)
        charge_mult   - the charge and spin multiplicity line
        coords        - list of (element, raw_line) tuples for each atom
        trailer_lines - any lines after the coordinate block
    """
    with open(filepath, 'r') as f:
        lines = f.readlines()

    raw_lines = [line.rstrip('\n\r') for line in lines]

    i = 0

    # Skip routing lines (starting with % or #)
    while i < len(raw_lines) and (
        raw_lines[i].startswith('%') or raw_lines[i].startswith('#')
    ):
        i += 1

    # Skip blank lines after routing
    while i < len(raw_lines) and raw_lines[i].strip() == '':
        i += 1

    # Skip the title line
    if i < len(raw_lines):
        i += 1

    # Skip blank lines after title
    while i < len(raw_lines) and raw_lines[i].strip() == '':
        i += 1

    # Now at the charge/multiplicity line
    if i >= len(raw_lines):
        raise ValueError("Could not find charge/multiplicity line.")

    charge_mult_idx = i
    i += 1

    # Collect coordinate lines
    coords = []
    while i < len(raw_lines):
        line = raw_lines[i]
        stripped = line.strip()
        if stripped == '':
            break
        tokens = stripped.split()
        if tokens:
            first_token = tokens[0]
            # Element symbols: 1-2 chars, first uppercase, optionally second lowercase
            if not re.match(r'^[A-Z][a-z]?$', first_token):
                break  # entered variables / post-coordinate section
            coords.append((first_token, line))
        i += 1

    trailer_start = i

    return {
        'header_lines': raw_lines[:charge_mult_idx + 1],
        'charge_mult': raw_lines[charge_mult_idx],
        'coords': coords,
        'trailer_lines': raw_lines[trailer_start:],
    }


def get_molecular_formula(elements):
    """Count elements and return formula string (e.g., 'C16H14O').

    Ordering: C first, H second, then all others alphabetically.
    """
    counts = Counter(elements)

    ordered = []
    for el in ['C', 'H']:
        if el in counts:
            ordered.append(el)

    for el in sorted(counts.keys()):
        if el not in ('C', 'H'):
            ordered.append(el)

    parts = []
    for el in ordered:
        n = counts[el]
        parts.append(el if n == 1 else f"{el}{n}")

    return ''.join(parts)


def parse_atom_selection(spec, max_atoms):
    """Parse a selection string like '1,3-5,7' into a sorted list of 1-based indices.

    Returns (list_of_indices, error_message).
    On success, error_message is None.
    """
    selected = set()
    parts = spec.split(',')

    for part in parts:
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            try:
                start_s, end_s = part.split('-', 1)
                start, end = int(start_s.strip()), int(end_s.strip())
                if start < 1 or end > max_atoms:
                    return None, f"Range {start}-{end} exceeds valid range 1-{max_atoms}."
                if start > end:
                    return None, f"Invalid range: {start}-{end} (start > end)."
                for j in range(start, end + 1):
                    selected.add(j)
            except ValueError:
                return None, f"Invalid range format: '{part}'."
        else:
            try:
                idx = int(part)
                if idx < 1 or idx > max_atoms:
                    return None, f"Atom index {idx} is out of range 1-{max_atoms}."
                selected.add(idx)
            except ValueError:
                return None, f"Invalid atom index: '{part}'."

    if not selected:
        return None, "No atoms selected."

    return sorted(selected), None


def swap_coords(coords, selected_indices, position):
    """Rearrange coordinates so selected atoms go to top or bottom.

    coords:           list of (element, raw_line) tuples
    selected_indices: list of 1-based indices to move
    position:         'top' or 'bottom'

    Returns new list of (element, raw_line) tuples.
    """
    n = len(coords)
    selected_0based = set(i - 1 for i in selected_indices)

    selected_atoms = [coords[i] for i in range(n) if i in selected_0based]
    remaining_atoms = [coords[i] for i in range(n) if i not in selected_0based]

    if position == 'top':
        return selected_atoms + remaining_atoms
    else:
        return remaining_atoms + selected_atoms


def write_gjf(filepath, parsed, new_coords):
    """Write a new .gjf file with rearranged coordinates."""
    with open(filepath, 'w') as f:
        for line in parsed['header_lines']:
            f.write(line + '\n')
        for _, raw_line in new_coords:
            f.write(raw_line + '\n')
        for line in parsed['trailer_lines']:
            f.write(line + '\n')


def print_atom_list(coords):
    """Print a numbered list of atoms."""
    print("\nAtom list:")
    print("-" * 50)
    for i, (el, raw_line) in enumerate(coords, 1):
        print(f"  {i:4d}  {el:<3s}  {raw_line.strip()}")
    print("-" * 50)


# ──────────────────────────────────────────────
#  Interactive mode
# ──────────────────────────────────────────────

def interactive_mode():
    """Run the script interactively, prompting the user for input."""
    input_path = input("Input .gjf file path: ").strip()
    if not os.path.exists(input_path):
        print(f"Error: File not found: {input_path}")
        sys.exit(1)

    parsed = parse_gjf(input_path)
    elements = [el for el, _ in parsed['coords']]
    n_atoms = len(elements)

    if n_atoms == 0:
        print("Error: No atoms found in the coordinate section.")
        sys.exit(1)

    # Molecular formula
    formula = get_molecular_formula(elements)
    print(f"\nMolecular formula: {formula}    Atom count: {n_atoms}")

    # Atom list
    print_atom_list(parsed['coords'])

    # Select atoms
    while True:
        print("\nEnter atom indices to move (e.g., 1,3-5,7):")
        sel_input = input("> ").strip()
        if not sel_input:
            print("No input provided. Exiting.")
            sys.exit(0)

        selected, err = parse_atom_selection(sel_input, n_atoms)
        if err:
            print(f"Error: {err}")
            continue

        print(f"Selected atoms: {selected}")
        confirm = input("Confirm? (y/n): ").strip().lower()
        if confirm == 'y':
            break

    # Choose top or bottom
    while True:
        print("\nMove selected atoms to top or bottom?")
        pos_input = input("> ").strip().lower()
        if pos_input in ('top', 'bottom'):
            break
        print("Please enter 'top' or 'bottom'.")

    # Output path
    output_path = input("\nOutput .gjf file path (Enter for same as input): ").strip()
    if not output_path:
        output_path = input_path

    # Rearrange and write
    new_coords = swap_coords(parsed['coords'], selected, pos_input)
    write_gjf(output_path, parsed, new_coords)
    print(f"\nDone! Written to: {output_path}")

    # Show new ordering
    print("\nNew atom order:")
    print("-" * 50)
    for i, (el, raw_line) in enumerate(new_coords, 1):
        print(f"  {i:4d}  {el:<3s}  {raw_line.strip()}")
    print("-" * 50)


# ──────────────────────────────────────────────
#  CLI mode
# ──────────────────────────────────────────────

def print_help():
    print(__doc__)


def cli_mode(argv):
    """Parse command-line flags and run non-interactively."""
    args = argv[1:]  # skip script name

    input_path = None
    output_path = None
    atom_spec = None
    position = None
    verbose = False

    i = 0
    while i < len(args):
        arg = args[i]

        if arg in ('-h', '--help'):
            print_help()
            sys.exit(0)

        elif arg == '-f':
            i += 1
            if i >= len(args):
                print("Error: -f requires a file path.")
                sys.exit(1)
            input_path = args[i]

        elif arg == '-o':
            i += 1
            if i >= len(args):
                print("Error: -o requires a file path.")
                sys.exit(1)
            output_path = args[i]

        elif arg == '-atoms':
            i += 1
            if i >= len(args):
                print("Error: -atoms requires an atom specification.")
                sys.exit(1)
            atom_spec = args[i]

        elif arg == '-t':
            position = 'top'

        elif arg == '-b':
            position = 'bottom'

        elif arg == '-v':
            verbose = True

        else:
            print(f"Error: Unknown argument: {arg}")
            print("Use -h for help.")
            sys.exit(1)

        i += 1

    # --- Validate required args ---
    if not input_path:
        print("Error: -f <input.gjf> is required.")
        sys.exit(1)
    if not os.path.exists(input_path):
        print(f"Error: File not found: {input_path}")
        sys.exit(1)
    if not atom_spec:
        print("Error: -atoms is required (e.g., -atoms 1,3-5).")
        sys.exit(1)
    if not position:
        print("Error: must specify -t (top) or -b (bottom).")
        sys.exit(1)

    # Default output: same as input
    if not output_path:
        output_path = input_path

    # --- Parse the .gjf file ---
    parsed = parse_gjf(input_path)
    elements = [el for el, _ in parsed['coords']]
    n_atoms = len(elements)

    if n_atoms == 0:
        print("Error: No atoms found in the coordinate section.")
        sys.exit(1)

    # Display molecular formula and atom count (always printed)
    formula = get_molecular_formula(elements)
    print(f"Molecular formula: {formula}    Atom count: {n_atoms}")

    # Verbose: print atom list
    if verbose:
        print_atom_list(parsed['coords'])

    # Parse atom selection
    selected, err = parse_atom_selection(atom_spec, n_atoms)
    if err:
        print(f"Error: {err}")
        sys.exit(1)

    if verbose:
        print(f"\nSelected atoms: {selected}")
        print(f"Position: {position}")

    # Rearrange
    new_coords = swap_coords(parsed['coords'], selected, position)

    # Write output
    write_gjf(output_path, parsed, new_coords)
    print(f"Written to: {output_path}")

    # Verbose: show new ordering
    if verbose:
        print("\nNew atom order:")
        print("-" * 50)
        for i, (el, raw_line) in enumerate(new_coords, 1):
            print(f"  {i:4d}  {el:<3s}  {raw_line.strip()}")
        print("-" * 50)


# ──────────────────────────────────────────────
#  Entry point
# ──────────────────────────────────────────────

def main():
    if len(sys.argv) == 1:
        # No arguments — interactive mode
        interactive_mode()
    else:
        cli_mode(sys.argv)


if __name__ == '__main__':
    main()
