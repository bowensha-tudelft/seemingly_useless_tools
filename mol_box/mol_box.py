#!/usr/bin/env python3
"""
mol_box.py - Calculate molecule counts, density, volume, and cubic box length
for molecular simulation boxes.

Examples:
  # Given molecule counts and density, calculate volume
  python mol_box.py -species "H2O:10,NH3:5" -density 1.0

  # Given molecule counts and volume, calculate density
  python mol_box.py -species "H2O:10,NH3:5" -volume 10

  # Given molecule ratio, density, and volume, calculate molecule counts
  python mol_box.py -species "H2O:NH3:HF=3:2:1" -density 1.0 -volume 10

Units:
  density: g/cm^3
  volume:  nm^3 and A^3
  length:  nm and A
"""

import argparse
import math
import re
import sys
from collections import defaultdict


AVOGADRO = 6.02214076e23
NM3_TO_CM3 = 1.0e-21

# Atomic masses in g/mol. Values are standard atomic weights where applicable.
ATOMIC_MASSES = {
    "H": 1.008,
    "He": 4.002602,
    "Li": 6.94,
    "Be": 9.0121831,
    "B": 10.81,
    "C": 12.011,
    "N": 14.007,
    "O": 15.999,
    "F": 18.998403163,
    "Ne": 20.1797,
    "Na": 22.98976928,
    "Mg": 24.305,
    "Al": 26.9815385,
    "Si": 28.085,
    "P": 30.973761998,
    "S": 32.06,
    "Cl": 35.45,
    "Ar": 39.948,
    "K": 39.0983,
    "Ca": 40.078,
    "Sc": 44.955908,
    "Ti": 47.867,
    "V": 50.9415,
    "Cr": 51.9961,
    "Mn": 54.938044,
    "Fe": 55.845,
    "Co": 58.933194,
    "Ni": 58.6934,
    "Cu": 63.546,
    "Zn": 65.38,
    "Ga": 69.723,
    "Ge": 72.630,
    "As": 74.921595,
    "Se": 78.971,
    "Br": 79.904,
    "Kr": 83.798,
    "Rb": 85.4678,
    "Sr": 87.62,
    "Y": 88.90584,
    "Zr": 91.224,
    "Nb": 92.90637,
    "Mo": 95.95,
    "Tc": 98.0,
    "Ru": 101.07,
    "Rh": 102.90550,
    "Pd": 106.42,
    "Ag": 107.8682,
    "Cd": 112.414,
    "In": 114.818,
    "Sn": 118.710,
    "Sb": 121.760,
    "Te": 127.60,
    "I": 126.90447,
    "Xe": 131.293,
    "Cs": 132.90545196,
    "Ba": 137.327,
    "La": 138.90547,
    "Ce": 140.116,
    "Pr": 140.90766,
    "Nd": 144.242,
    "Pm": 145.0,
    "Sm": 150.36,
    "Eu": 151.964,
    "Gd": 157.25,
    "Tb": 158.92535,
    "Dy": 162.500,
    "Ho": 164.93033,
    "Er": 167.259,
    "Tm": 168.93422,
    "Yb": 173.045,
    "Lu": 174.9668,
    "Hf": 178.49,
    "Ta": 180.94788,
    "W": 183.84,
    "Re": 186.207,
    "Os": 190.23,
    "Ir": 192.217,
    "Pt": 195.084,
    "Au": 196.966569,
    "Hg": 200.592,
    "Tl": 204.38,
    "Pb": 207.2,
    "Bi": 208.98040,
    "Po": 209.0,
    "At": 210.0,
    "Rn": 222.0,
    "Fr": 223.0,
    "Ra": 226.0,
    "Ac": 227.0,
    "Th": 232.0377,
    "Pa": 231.03588,
    "U": 238.02891,
}


def parse_formula(formula):
    """Parse a simple chemical formula without parentheses.

    Supports omitted subscripts and repeated elements:
      H2O       -> H:2, O:1
      NaCl      -> Na:1, Cl:1
      CH3CH2OH  -> C:2, H:6, O:1
    """
    if not formula:
        raise ValueError("Empty formula.")
    if any(ch in formula for ch in "()[]{}"):
        raise ValueError(f"Formula with parentheses is not supported: {formula}")

    pattern = re.compile(r"([A-Z][a-z]?)(\d*)")
    composition = defaultdict(int)
    pos = 0

    for match in pattern.finditer(formula):
        if match.start() != pos:
            bad = formula[pos:match.start()]
            raise ValueError(f"Invalid formula near '{bad}' in {formula}")

        element, count_text = match.groups()
        if element not in ATOMIC_MASSES:
            raise ValueError(f"Unknown element '{element}' in formula {formula}")

        count = int(count_text) if count_text else 1
        composition[element] += count
        pos = match.end()

    if pos != len(formula):
        bad = formula[pos:]
        raise ValueError(f"Invalid formula near '{bad}' in {formula}")
    if not composition:
        raise ValueError(f"Could not parse formula: {formula}")

    return dict(composition)


def molar_mass(formula):
    """Return molecular molar mass in g/mol."""
    composition = parse_formula(formula)
    return sum(ATOMIC_MASSES[element] * count for element, count in composition.items())


def parse_species(species_text):
    """Parse -species input.

    Fixed-count format:
      H2O:10,NH3:5
      -> mode='count', names=['H2O','NH3'], values=[10,5]

    Ratio format:
      H2O:NH3:HF=3:2:1
      -> mode='ratio', names=['H2O','NH3','HF'], values=[3,2,1]
    """
    text = species_text.strip()
    if not text:
        raise ValueError("-species cannot be empty.")

    # Allow optional surrounding braces if user types {H2O:10,NH3:5}
    if text.startswith("{") and text.endswith("}"):
        text = text[1:-1].strip()

    if "=" in text:
        left, right = text.split("=", 1)
        names = [x.strip() for x in left.split(":") if x.strip()]
        values = [x.strip() for x in right.split(":") if x.strip()]

        if len(names) != len(values):
            raise ValueError("Ratio format requires the same number of species and ratio values.")
        if not names:
            raise ValueError("No species found in ratio format.")

        ratios = []
        for value in values:
            try:
                ratio = float(value)
            except ValueError:
                raise ValueError(f"Invalid ratio value: {value}")
            if ratio <= 0:
                raise ValueError("Ratio values must be positive.")
            ratios.append(ratio)

        for name in names:
            parse_formula(name)

        return "ratio", names, ratios

    items = [x.strip() for x in text.split(",") if x.strip()]
    if not items:
        raise ValueError("No species found in count format.")

    names = []
    counts = []
    for item in items:
        if ":" not in item:
            raise ValueError(f"Invalid species item '{item}'. Expected Formula:Count.")
        name, count_text = item.split(":", 1)
        name = name.strip()
        count_text = count_text.strip()
        if not name or not count_text:
            raise ValueError(f"Invalid species item '{item}'. Expected Formula:Count.")

        parse_formula(name)
        try:
            count = float(count_text)
        except ValueError:
            raise ValueError(f"Invalid molecule count: {count_text}")
        if count < 0:
            raise ValueError("Molecule counts must be non-negative.")

        names.append(name)
        counts.append(count)

    return "count", names, counts


def total_mass_g(names, counts):
    """Return total mass in grams for given molecule counts."""
    mass = 0.0
    for name, count in zip(names, counts):
        mass += count * molar_mass(name) / AVOGADRO
    return mass


def volume_from_density(names, counts, density):
    """Calculate volume in nm^3 from counts and density in g/cm^3."""
    mass_g = total_mass_g(names, counts)
    volume_cm3 = mass_g / density
    return volume_cm3 / NM3_TO_CM3


def density_from_volume(names, counts, volume):
    """Calculate density in g/cm^3 from counts and volume in nm^3."""
    mass_g = total_mass_g(names, counts)
    volume_cm3 = volume * NM3_TO_CM3
    return mass_g / volume_cm3


def counts_from_ratio(names, ratios, density, volume):
    """Calculate molecule counts from species ratios, density, and volume.

    Counts can be non-integers.
    """
    volume_cm3 = volume * NM3_TO_CM3
    target_mass_g = density * volume_cm3

    mass_per_ratio_unit_g = 0.0
    for name, ratio in zip(names, ratios):
        mass_per_ratio_unit_g += ratio * molar_mass(name) / AVOGADRO

    scale = target_mass_g / mass_per_ratio_unit_g
    return [ratio * scale for ratio in ratios]


def cubic_length(volume):
    """Return cubic box side length in nm from volume in nm^3."""
    return volume ** (1.0 / 3.0)


def format_float(value):
    """Format floats compactly but with enough precision."""
    return f"{value:.10g}"


def print_result(names, counts, density, volume):
    """Print structured results in the requested order."""
    length = cubic_length(volume)
    volume_a3 = volume * 1000.0
    length_a = length * 10.0

    print("Result")
    print("======")
    print("1. Molecule counts")
    for name, count in zip(names, counts):
        print(f"   - {name}: {format_float(count)}")
    print(f"2. Density: {format_float(density)} g/cm^3")
    print(f"3. Volume:  {format_float(volume)} nm^3  =  {format_float(volume_a3)} A^3")
    print(f"4. Cubic box length: {format_float(length)} nm  =  {format_float(length_a)} A")


def build_parser():
    parser = argparse.ArgumentParser(
        description="Calculate molecular simulation box composition, density, volume, and cubic box length."
    )
    parser.add_argument(
        "-species",
        required=True,
        help='Species input, e.g. "H2O:10,NH3:5" or "H2O:NH3:HF=3:2:1"',
    )
    parser.add_argument(
        "-density",
        type=float,
        help="Density in g/cm^3",
    )
    parser.add_argument(
        "-volume",
        type=float,
        help="Volume in nm^3",
    )
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.density is not None and args.density <= 0:
        parser.error("-density must be positive.")
    if args.volume is not None and args.volume <= 0:
        parser.error("-volume must be positive.")

    try:
        mode, names, values = parse_species(args.species)

        if mode == "count":
            counts = values
            if args.density is not None and args.volume is None:
                density = args.density
                volume = volume_from_density(names, counts, density)
            elif args.volume is not None and args.density is None:
                volume = args.volume
                density = density_from_volume(names, counts, volume)
            elif args.volume is not None and args.density is not None:
                # Counts are given, so density and volume overdetermine the system.
                actual_density = density_from_volume(names, counts, args.volume)
                raise ValueError(
                    "For fixed molecule counts, provide either -density or -volume, not both. "
                    f"With the given counts and volume, the density would be {format_float(actual_density)} g/cm^3."
                )
            else:
                raise ValueError("For fixed molecule counts, provide either -density or -volume.")

        else:
            ratios = values
            if args.density is None or args.volume is None:
                raise ValueError("For ratio species input, both -density and -volume are required.")
            density = args.density
            volume = args.volume
            counts = counts_from_ratio(names, ratios, density, volume)

        print_result(names, counts, density, volume)

    except ValueError as err:
        print(f"Error: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
