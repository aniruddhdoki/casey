import re
import json
from datetime import datetime
from NYU_Stern_Parser import CasebookParser

class DynamoDBCaseFormatter:
    """Format parsed cases for DynamoDB-ready JSON format"""
    
    @staticmethod
    def is_valid_case(case_data: dict) -> bool:
        """Filter out false positive cases (page numbers, headers, etc.)"""
        title = case_data['metadata'].get('title', '')
        
        # Filter out cases that are clearly not real cases
        invalid_patterns = [
            r'^Structure:',
            r'^\d+$',
            r'^©',
            r'^Page \d+',
            r'^Exhibit',
            r'^Question \d+'
        ]
        
        for pattern in invalid_patterns:
            if re.match(pattern, title, re.IGNORECASE):
                return False
        
        # Title must be long enough to be a name
        if len(title) < 5:
            return False
        
        # Must have at least a case prompt or industry info to be useful
        if not case_data.get('case_prompt') and not case_data['overview'].get('industry'):
            return False
        
        return True
    
    @staticmethod
    def format_for_dynamodb(case_data: dict) -> dict:
        """Transform raw parsed data into a clean, standardized schema"""
        metadata = case_data.get('metadata', {})
        overview = case_data.get('overview', {})
        framework = case_data.get('framework_guide', {})
        
        item = {
            # Primary key ID
            'case_id': case_data.get('case_id', ''),
            
            # Metadata
            'title': metadata.get('title', ''),
            'author': metadata.get('author', ''),
            'firm_style': metadata.get('firm_style', ''),
            'case_style': metadata.get('case_style', ''),
            
            # Case categorization
            'industry': overview.get('industry', ''),
            'case_type': overview.get('case_type', ''),
            
            # Difficulty ratings
            'difficulty': {
                'quant': metadata.get('quant_difficulty', 0),
                'structure': metadata.get('structure_difficulty', 0)
            },
            
            # Skills tested
            'concepts_tested': overview.get('concepts_tested', []),
            
            # Case content
            'case_prompt': case_data.get('case_prompt', ''),
            'clarifying_info': framework.get('clarifying_info', ''),
            'expected_framework': framework.get('expected_framework', ''),
            'interviewer_notes': overview.get('interviewer_notes', ''),
            
            # Questions and exhibits
            'questions': case_data.get('questions', []),
            'exhibits': case_data.get('exhibits', []),
            
            # Recommendation
            'recommendation': case_data.get('recommendation', {}),
            
            # Metadata Timestamps
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }
        
        return item


def main():
    """Main function to parse and format cases"""
    print("=" * 60)
    print("NYU Stern Casebook: DynamoDB Formatter")
    print("=" * 60)
    
    # 1. Path to your raw text file
    input_text_file = '2025_NYU_Stern_pdf_output.txt'
    # 2. Path to your desired output file
    output_json_file = 'PARSED_2025_NYU_Stern_DYNAMO.json'
    
    try:
        # Initialize Parser
        parser = CasebookParser(input_text_file)
        raw_cases = parser.parse_all_cases()
        print(f"\n[1/3] Initial parsing found: {len(raw_cases)} potential cases")
        
        # Filter and format
        formatter = DynamoDBCaseFormatter()
        valid_cases = []
        invalid_count = 0
        
        for case in raw_cases:
            if formatter.is_valid_case(case):
                dynamodb_item = formatter.format_for_dynamodb(case)
                valid_cases.append(dynamodb_item)
            else:
                invalid_count += 1
        
        print(f"[2/3] Filtered out {invalid_count} junk items")
        print(f"[3/3] Successfully formatted {len(valid_cases)} valid cases")
        
        # Save to JSON
        with open(output_json_file, 'w', encoding='utf-8') as f:
            json.dump(valid_cases, f, indent=2, ensure_ascii=False)
        
        print(f"\n✅ SUCCESS: File saved as {output_json_file}")
        
        # Print a small preview of the results
        print("\n" + "=" * 60)
        print("SUMMARY PREVIEW (First 5 Cases)")
        print("=" * 60)
        for case in valid_cases[:5]:
            print(f"• {case['title']} ({case['industry']})")
            print(f"  - Type: {case['case_type']}")
            print(f"  - Questions: {len(case['questions'])}")
        
    except FileNotFoundError:
        print(f"Error: Could not find the file '{input_text_file}'. Make sure it is in the same folder.")
    except Exception as e:
        print(f"An error occurred: {str(e)}")

if __name__ == '__main__':
    main()