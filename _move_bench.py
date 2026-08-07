"""Move --benchmark handler before resolve_program_path in cli.py main()."""
path = 'bounty_agent/cli.py'
s = open(path, encoding='utf-8').read()

old_block = '''    # Milestone 5.2: evaluation harness
    if args.benchmark:
        from .benchmark import run_benchmark
        scope_path = (args.program or (args.engagement / "program" / "scope.json")) if args.program or args.engagement else None
        scorecard_path = run_benchmark(args.benchmark, scope_path, dry=not args.execute)
        print(f"Benchmark scorecard: {scorecard_path}")
        return 0

    if args.clean or args.clean_apply:'''

new_block = '''    # Milestone 5.2: evaluation harness -- runs before scope resolution (dry mode needs no program)
    if args.benchmark:
        from .benchmark import run_benchmark
        scope_path = (args.program or (args.engagement / "program" / "scope.json")) if args.program or args.engagement else None
        scorecard_path = run_benchmark(args.benchmark, scope_path, dry=not args.execute)
        print(f"Benchmark scorecard: {scorecard_path}")
        return 0

    if args.clean or args.clean_apply:'''

assert old_block in s, 'block to move not found'
s = s.replace(old_block, new_block, 1)

# Remove the handler from its late position and place it right after parse_args
late_handler = '''    # Milestone 5.2: evaluation harness -- runs before scope resolution (dry mode needs no program)
    if args.benchmark:
        from .benchmark import run_benchmark
        scope_path = (args.program or (args.engagement / "program" / "scope.json")) if args.program or args.engagement else None
        scorecard_path = run_benchmark(args.benchmark, scope_path, dry=not args.execute)
        print(f"Benchmark scorecard: {scorecard_path}")
        return 0

'''
assert late_handler in s, 'late handler not found (already moved?)'
s = s.replace(late_handler, '', 1)

early_anchor = '''    args = build_parser().parse_args(argv)
    load_env_file(Path(".env"))
    program_path = resolve_program_path(args.program, args.engagement)'''
early_new = '''    args = build_parser().parse_args(argv)
    load_env_file(Path(".env"))
    # Milestone 5.2: evaluation harness -- dry mode needs no program/engagement
    if args.benchmark:
        from .benchmark import run_benchmark
        scope_path = (args.program or (args.engagement / "program" / "scope.json")) if args.program or args.engagement else None
        scorecard_path = run_benchmark(args.benchmark, scope_path, dry=not args.execute)
        print(f"Benchmark scorecard: {scorecard_path}")
        return 0
    program_path = resolve_program_path(args.program, args.engagement)'''
assert early_anchor in s, 'early anchor not found'
s = s.replace(early_anchor, early_new, 1)

open(path, 'w', encoding='utf-8').write(s)
print('handler moved early')
