"""Interactive human review. Never automatically promote teacher drafts to labels."""
import argparse
import json
from pathlib import Path
import random
import re
from dataset import FIELDS, PHONE
from normalizer import normalize

INTENTS = ['register','crop_problem','correction','confirmation','repeat','request_expert','audibility','other']


def review(source, destination, reviewer):
    records = [json.loads(line) for line in source.read_text(encoding='utf-8').splitlines() if line.strip()]
    accepted = []
    if destination.exists():
        accepted = [json.loads(line) for line in destination.read_text(encoding='utf-8').splitlines() if line.strip()]
    done = {r['id'] for r in accepted}
    for item in records:
        if item['id'] in done:
            continue
        print('\nDRAFT:', json.dumps(item, ensure_ascii=False, indent=2))
        decision = input('Personally checked meaning, dialect and absence of private data? [yes/skip/stop]: ').strip()
        if decision == 'stop':
            break
        if decision != 'yes':
            continue
        value = input('Correct original text, or Enter to keep: ').strip() or item['text']
        value = normalize(value)
        if PHONE.search(value):
            raise ValueError('Personal phone data is not allowed')
        normalized = input('Reviewed normalized sentence: ').strip()
        facts = json.loads(input('Reviewed facts JSON, exact source spans only: '))
        if set(facts) - set(FIELDS) or any(not isinstance(v,str) or not v or v not in value for v in facts.values()):
            raise ValueError('Fact values must be exact spans of normalized original text')
        intent = input('Intent ('+', '.join(INTENTS)+'): ').strip()
        if intent not in INTENTS or not normalized:
            raise ValueError('Reviewed intent and normalization target required')
        group = input('Conversation/paraphrase group ID (keep related examples together): ').strip()
        if not group:
            raise ValueError('A reviewed grouping decision is required')
        accepted.append({**item,'text':value,'normalized':normalized,'facts':facts,'intent':intent,'groupId':group,'entities':[{'label':k,'start':value.index(v),'end':value.index(v)+len(v)} for k,v in facts.items()],'reviewedBy':reviewer,'status':'reviewed','containsPersonalData':False,'requiresSpanReview':False,'split':'unassigned'})
        destination.parent.mkdir(parents=True,exist_ok=True)
        destination.write_text('\n'.join(json.dumps(row,ensure_ascii=False) for row in accepted)+'\n',encoding='utf-8')
    return accepted


def split(source, destination):
    records = [json.loads(line) for line in source.read_text(encoding='utf-8').splitlines() if line.strip()]
    if len(records) < 300 or any(r.get('status')!='reviewed' or not r.get('reviewedBy') for r in records):
        raise ValueError('Review at least 300 examples before splitting the first training corpus')
    groups = sorted({r['groupId'] for r in records})
    if len(groups) < 6:
        raise ValueError('At least six independent scenario groups are required')
    random.Random(42).shuffle(groups)
    # Group boundaries take precedence over exact 200/50/50 counts to prevent leakage.
    n = len(groups)
    assigned={g:'train' if i<n*2//3 else 'dev' if i<n*5//6 else 'test' for i,g in enumerate(groups)}
    for row in records:
        row['split']=assigned[row['groupId']]
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text('\n'.join(json.dumps(row,ensure_ascii=False) for row in records)+'\n',encoding='utf-8')
    print(json.dumps({s:sum(r['split']==s for r in records) for s in ['train','dev','test']}))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['review','split'])
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--reviewer')
    args=parser.parse_args()
    if args.command=='review':
        if not args.reviewer:
            parser.error('--reviewer is required')
        review(args.input,args.output,args.reviewer)
    else:
        split(args.input,args.output)
