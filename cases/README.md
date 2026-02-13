# NYU Stern Casebook Parser

## Overview
This parser extracts case study data from the NYU Stern MCA Casebook PDF and structures it for upload to DynamoDB.

## Usage

### 1. Extract text from PDF
```bash
pdftotext casebook.pdf output.txt
```

### 2. Run the parser
```bash
python casebook_parser.py
```

### 3. Output
The parser generates `parsed_cases.json` with structured case data ready for DynamoDB.

## DynamoDB Schema

### Table: CaseStudies

**Primary Key:**
- `case_id` (String) - Partition key, generated from case title (e.g., "one_mans_trash")

**Attributes:**
```json
{
  "case_id": "string",           // Unique ID: lowercase title with underscores
  "title": "string",             // Case title
  "author": "string",            // Case author(s)
  "firm_style": "string",        // Consulting firm and round (e.g., "McKinsey First Round")
  "case_style": "string",        // "Interviewer-Led" or "Candidate-Led"
  "industry": "string",          // Industry category
  "case_type": "string",         // e.g., "Profitability", "Market Entry", etc.
  "difficulty": {
    "quant": number,             // 1-10 scale for math difficulty
    "structure": number          // 1-10 scale for framework difficulty
  },
  "concepts_tested": ["string"], // List of concepts/skills tested
  "case_prompt": "string",       // The main scenario/prompt
  "clarifying_info": "string",   // Background information for interviewer
  "expected_framework": "string",// Expected framework structure
  "interviewer_notes": "string", // Additional tips for interviewer
  "questions": [                 // Array of questions in the case
    {
      "type": "string",          // "math", "brainstorming", "general"
      "prompt": "string",        // Question text
      "solution_notes": "string" // Solution/approach notes
    }
  ],
  "exhibits": [                  // Data tables/charts
    {
      "exhibit_number": number,
      "content": "string"
    }
  ],
  "recommendation": {
    "recommendation": "string",  // Expected recommendation
    "risks": "string",          // Risk considerations
    "next_steps": "string",     // Recommended next steps
    "excellence_tips": "string" // Bonus tips for excellent performance
  },
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

## Sample DynamoDB Item

```json
{
  "case_id": "one_mans_trash",
  "title": "One Man's Trash",
  "author": "Rachel Wang (Stern '25)",
  "firm_style": "McKinsey First Round",
  "case_style": "Interviewer-Led",
  "industry": "Waste Management",
  "case_type": "Opportunity Assessment",
  "difficulty": {
    "quant": 4,
    "structure": 6
  },
  "concepts_tested": ["Profitability", "Brainstorming"],
  "case_prompt": "Your client is Gremlin Services...",
  "questions": [
    {
      "type": "brainstorming",
      "prompt": "What factors should Gremlin Services consider...",
      "solution_notes": "Candidates should be structured..."
    }
  ]
}
```

## Filtering & Uploading to DynamoDB

To upload to DynamoDB, you can use the AWS SDK (boto3):

```python
import boto3
import json

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('CaseStudies')

with open('parsed_cases.json', 'r') as f:
    cases = json.load(f)
    
for case in cases:
    # Filter out false positives
    if case['metadata'].get('title') and len(case['metadata']['title']) > 10:
        # Transform to DynamoDB format
        item = {
            'case_id': case['case_id'],
            'title': case['metadata']['title'],
            'author': case['metadata'].get('author', ''),
            'firm_style': case['metadata'].get('firm_style', ''),
            'case_style': case['metadata'].get('case_style', ''),
            'industry': case['overview'].get('industry', ''),
            'case_type': case['overview'].get('case_type', ''),
            'difficulty': {
                'quant': case['metadata'].get('quant_difficulty', 0),
                'structure': case['metadata'].get('structure_difficulty', 0)
            },
            'concepts_tested': case['overview'].get('concepts_tested', []),
            'case_prompt': case.get('case_prompt', ''),
            'clarifying_info': case['framework_guide'].get('clarifying_info', ''),
            'expected_framework': case['framework_guide'].get('expected_framework', ''),
            'questions': case.get('questions', []),
            'recommendation': case.get('recommendation', {})
        }
        
        # Upload to DynamoDB
        table.put_item(Item=item)
        print(f"Uploaded: {item['title']}")
```

## Notes

- Some false positives may occur (e.g., lines starting with "Structure:")
- Manual review of parsed cases is recommended before upload
- The parser extracts ~25-30 cases from the NYU Stern casebook