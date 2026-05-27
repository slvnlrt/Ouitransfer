#!/usr/bin/env python3
"""
Script to check translation status and identify strings that need translation.
"""

import json
from pathlib import Path
from typing import Dict, Any, List, Tuple
import argparse


def load_json_file(file_path: Path) -> Dict[str, Any]:
    """Load a JSON file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading {file_path}: {e}")
        return {}


def get_all_string_values(data: Dict[str, Any], prefix: str = '') -> List[Tuple[str, str]]:
    """Extract all strings from nested JSON with their keys."""
    strings = []
    
    for key, value in data.items():
        current_key = f"{prefix}.{key}" if prefix else key
        
        if isinstance(value, str):
            strings.append((current_key, value))
        elif isinstance(value, dict):
            strings.extend(get_all_string_values(value, current_key))
    
    return strings


def check_untranslated_strings(file_path: Path) -> Tuple[int, int, List[str]]:
    """Check for untranslated strings in a file."""
    data = load_json_file(file_path)
    if not data:
        return 0, 0, []
    
    all_strings = get_all_string_values(data)
    untranslated = []
    
    for key, value in all_strings:
        if value.startswith('[TO_TRANSLATE]'):
            untranslated.append(key)
    
    return len(all_strings), len(untranslated), untranslated


# Technical terms that are legitimately kept in English across all languages.
# Matching is case-insensitive. Strings containing any of these are excluded
# from "suspected untranslated".
_TECHNICAL_TERMS = (
    # Auth protocols & standards
    'ldap', 'ldaps', 'oidc', 'openid', 'oauth', 'saml', 'scim', 'starttls',
    # Microsoft / directory services
    'active directory',
    # LDAP DN notation (e.g. CN=...,DC=...)
    'cn=', 'dc=', 'ou=',
    # OAuth / OIDC endpoint & config labels
    'endpoint', 'callback url',
    # UI: technical section labels conventionally kept in English
    'background image',  # covers "background image" and "background images"
)


def _is_suspected_untranslated(value: str) -> bool:
    """Return True if a string looks like untranslated English natural-language text."""
    if len(value) <= 15:
        return False
    if value.startswith('http://') or value.startswith('https://'):
        return False
    if value.startswith('{'):
        return False
    # Date/format patterns
    if any(pat in value for pat in ('MM/DD', 'HH:MM', 'YYYY', '%Y', '%m', '%d')):
        return False
    # Known technical terms legitimately kept in English (case-insensitive)
    lower = value.lower()
    if any(term in lower for term in _TECHNICAL_TERMS):
        return False
    return True


def compare_languages(reference_file: Path, target_file: Path) -> Dict[str, Any]:
    """Compare two language files."""
    reference_data = load_json_file(reference_file)
    target_data = load_json_file(target_file)
    
    if not reference_data or not target_data:
        return {}
    
    reference_strings = dict(get_all_string_values(reference_data))
    target_strings = dict(get_all_string_values(target_data))
    
    # Find common keys
    common_keys = set(reference_strings.keys()) & set(target_strings.keys())
    
    # All identical strings (broad — for "possible matches" count)
    identical_strings = []
    # Suspected untranslated: stricter filter
    suspected_untranslated = []
    for key in common_keys:
        ref_val = reference_strings[key]
        if ref_val == target_strings[key]:
            if len(ref_val) > 3:
                identical_strings.append(key)
            if _is_suspected_untranslated(ref_val):
                suspected_untranslated.append(key)
    
    return {
        'total_reference': len(reference_strings),
        'total_target': len(target_strings),
        'common_keys': len(common_keys),
        'identical_strings': identical_strings,
        'suspected_untranslated': suspected_untranslated,
    }


def generate_translation_report(messages_dir: Path, reference_file: str = 'en-US.json'):
    """Generate complete translation report."""
    reference_path = messages_dir / reference_file
    if not reference_path.exists():
        print(f"Reference file not found: {reference_path}")
        return
    
    # Load reference data
    reference_data = load_json_file(reference_path)
    reference_strings = dict(get_all_string_values(reference_data))
    total_reference_strings = len(reference_strings)
    
    print(f"📊 TRANSLATION REPORT")
    print(f"Reference: {reference_file} ({total_reference_strings} strings)")
    print("=" * 80)
    
    # Find all JSON files
    json_files = [f for f in messages_dir.glob('*.json') if f.name != reference_file]
    
    if not json_files:
        print("No translation files found")
        return
    
    reports = []
    
    for json_file in sorted(json_files):
        total_strings, untranslated_count, untranslated_keys = check_untranslated_strings(json_file)
        comparison = compare_languages(reference_path, json_file)
        
        # Calculate percentages
        completion_percentage = (total_strings / total_reference_strings) * 100 if total_reference_strings > 0 else 0
        untranslated_percentage = (untranslated_count / total_strings) * 100 if total_strings > 0 else 0
        
        reports.append({
            'file': json_file.name,
            'total_strings': total_strings,
            'untranslated_count': untranslated_count,
            'untranslated_keys': untranslated_keys,
            'completion_percentage': completion_percentage,
            'untranslated_percentage': untranslated_percentage,
            'identical_strings': comparison.get('identical_strings', []),
            'suspected_untranslated': comparison.get('suspected_untranslated', []),
        })
    
    # Sort by completion percentage, then suspected count
    reports.sort(key=lambda x: (-x['completion_percentage'], x['untranslated_count'], len(x['suspected_untranslated'])))
    
    print(f"{'LANGUAGE':<15} {'COMPLETENESS':<12} {'STRINGS':<15} {'[TO_TRANSLATE]':<16} {'SUSPECTED EN'}")
    print("-" * 80)
    
    for report in reports:
        language = report['file'].replace('.json', '')
        completion = f"{report['completion_percentage']:.1f}%"
        strings_info = f"{report['total_strings']}/{total_reference_strings}"
        untranslated_info = f"{report['untranslated_count']} ({report['untranslated_percentage']:.1f}%)"
        suspected_count = len(report['suspected_untranslated'])
        
        # Choose icon based on completeness and suspected untranslated
        if report['completion_percentage'] >= 100 and report['untranslated_count'] == 0:
            icon = "✅" if suspected_count == 0 else "⚠️"
        elif report['completion_percentage'] >= 90:
            icon = "🟡"
        else:
            icon = "🔴"
        
        print(f"{icon} {language:<13} {completion:<12} {strings_info:<15} {untranslated_info:<16} {suspected_count}")
    
    print("\n" + "=" * 80)
    
    # Show details of problematic files
    problematic_files = [
        r for r in reports
        if r['untranslated_count'] > 0 or r['completion_percentage'] < 100 or r['suspected_untranslated']
    ]
    
    if problematic_files:
        print("📋 DETAILS OF FILES THAT NEED ATTENTION:")
        print()
        
        for report in problematic_files:
            language = report['file'].replace('.json', '')
            print(f"🔍 {language.upper()}:")
            
            if report['completion_percentage'] < 100:
                missing_count = total_reference_strings - report['total_strings']
                print(f"   • Missing {missing_count} strings ({100 - report['completion_percentage']:.1f}%)")
            
            if report['untranslated_count'] > 0:
                print(f"   • {report['untranslated_count']} strings marked as [TO_TRANSLATE]")
                
                if report['untranslated_count'] <= 10:
                    for key in report['untranslated_keys']:
                        print(f"     - {key}")
                else:
                    for key in report['untranslated_keys'][:10]:
                        print(f"     - {key}")
                    print(f"     ... and {report['untranslated_count'] - 10} more")
            
            if report['suspected_untranslated']:
                suspected = report['suspected_untranslated']
                print(f"   • {len(suspected)} strings suspected untranslated (identical to English, >15 chars):")
                # Group by top-level namespace
                by_ns: Dict[str, List[str]] = {}
                for key in suspected:
                    ns = key.split('.')[0]
                    by_ns.setdefault(ns, []).append(key)
                for ns, keys in sorted(by_ns.items(), key=lambda x: -len(x[1])):
                    sample = reference_strings.get(keys[0], '')[:40]
                    print(f"     [{ns}] {len(keys)} keys  e.g. \"{sample}{'...' if len(reference_strings.get(keys[0],'')) > 40 else ''}\"")
            
            print()
    
    else:
        print("🎉 All translations are complete!")
    
    print("=" * 80)
    print("💡 TIPS:")
    print("• Use 'python3 sync_translations.py --dry-run' to see what would be added")
    print("• Use 'python3 sync_translations.py' to synchronize all translations")
    print("• Strings marked with [TO_TRANSLATE] need manual translation")
    print("• Strings in 'SUSPECTED EN' column may need translation (identical to English reference)")


def main():
    parser = argparse.ArgumentParser(
        description='Check translation status and identify strings that need translation'
    )
    parser.add_argument(
        '--messages-dir', 
        type=Path,
        default=Path(__file__).parent.parent / 'messages',
        help='Directory containing message files (default: ../messages)'
    )
    parser.add_argument(
        '--reference', 
        default='en-US.json',
        help='Reference file (default: en-US.json)'
    )
    
    args = parser.parse_args()
    
    if not args.messages_dir.exists():
        print(f"Directory not found: {args.messages_dir}")
        return 1
    
    generate_translation_report(args.messages_dir, args.reference)
    return 0


if __name__ == '__main__':
    exit(main()) 