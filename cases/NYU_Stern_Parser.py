import re
import json
from typing import Dict, List, Optional

class CasebookParser:
    """Parser for NYU Stern Casebook to extract case studies into DynamoDB-ready JSON format"""
    
    def __init__(self, text_file_path: str):
        with open(text_file_path, 'r', encoding='utf-8') as f:
            self.full_text = f.read()
        self.cases = []
    
    def extract_case_metadata(self, case_text: str) -> Dict:
        """Extract metadata like title, author, firm, difficulty, etc."""
        metadata = {}
        
        # Extract title (first line of case)
        lines = case_text.strip().split('\n')
        metadata['title'] = lines[0].strip() if lines else ""
        
        # Extract author and firm info
        author_match = re.search(r'Author[s]?:\s*(.+?)(?:Firm|$)', case_text, re.IGNORECASE)
        if author_match:
            metadata['author'] = author_match.group(1).strip()
        
        firm_match = re.search(r'Firm.*?:\s*(.+?)(?:\[|\n)', case_text, re.IGNORECASE)
        if firm_match:
            metadata['firm_style'] = firm_match.group(1).strip()
        
        # Extract case style (interviewer-led, candidate-led, etc.)
        style_match = re.search(r'\[(.*?-led)\]', case_text, re.IGNORECASE)
        if style_match:
            metadata['case_style'] = style_match.group(1).strip()
        
        # Extract difficulty ratings
        quant_match = re.search(r'Quant:\s*(\d+)', case_text)
        if quant_match:
            metadata['quant_difficulty'] = int(quant_match.group(1))
        
        structure_match = re.search(r'Structure:\s*(\d+)', case_text)
        if structure_match:
            metadata['structure_difficulty'] = int(structure_match.group(1))
        
        return metadata
    
    def extract_case_prompt(self, case_text: str) -> Optional[str]:
        """Extract the case prompt/scenario"""
        prompt_match = re.search(
            r'Case Prompt:\s*\n(.+?)(?=\n\n|Case Overview:|$)', 
            case_text, 
            re.DOTALL
        )
        if prompt_match:
            return prompt_match.group(1).strip()
        return None
    
    def extract_case_overview(self, case_text: str) -> Dict:
        """Extract case overview information"""
        overview = {}
        
        # Industry
        industry_match = re.search(r'Industry:\s*(.+?)(?:\n|$)', case_text)
        if industry_match:
            overview['industry'] = industry_match.group(1).strip()
        
        # Case Structure/Type
        structure_match = re.search(r'Case Structure:\s*(.+?)(?:\n|Concepts)', case_text, re.DOTALL)
        if structure_match:
            overview['case_type'] = structure_match.group(1).strip()
        
        # Concepts Tested
        concepts_match = re.search(r'Concepts Tested:\s*(.+?)(?=\n\n|©|$)', case_text, re.DOTALL)
        if concepts_match:
            concepts_text = concepts_match.group(1).strip()
            # Extract bullet points
            concepts = re.findall(r'[•●]\s*(.+?)(?=\n|$)', concepts_text)
            overview['concepts_tested'] = [c.strip() for c in concepts]
        
        # Overview Information (tips for interviewer)
        overview_info_match = re.search(
            r'Overview Information for Interviewer:\s*(.+?)(?=\n\n|Clarifying|$)', 
            case_text, 
            re.DOTALL
        )
        if overview_info_match:
            overview['interviewer_notes'] = overview_info_match.group(1).strip()
        
        return overview
    
    def extract_framework_guide(self, case_text: str) -> Dict:
        """Extract the interviewer guide with expected framework"""
        framework = {}
        
        # Clarifying Information
        clarifying_match = re.search(
            r'Clarifying Information:\s*(.+?)(?=Interviewer Guide:|$)', 
            case_text, 
            re.DOTALL
        )
        if clarifying_match:
            framework['clarifying_info'] = clarifying_match.group(1).strip()
        
        # Interviewer Guide (expected framework)
        guide_match = re.search(
            r'Interviewer Guide:\s*(.+?)(?=\n\n\n|Question|Math|Brainstorming|Recommendation|$)', 
            case_text, 
            re.DOTALL
        )
        if guide_match:
            framework['expected_framework'] = guide_match.group(1).strip()
        
        return framework
    
    def extract_questions(self, case_text: str) -> List[Dict]:
        """Extract all questions from the case"""
        questions = []
        
        # Find all question sections
        question_sections = re.findall(
            r'((?:Math|Brainstorming|Question)\s*(?:#?\d+)?:.*?(?=(?:Math|Brainstorming|Question|Recommendation:|Exhibit|$)))', 
            case_text, 
            re.DOTALL
        )
        
        for section in question_sections:
            question = {}
            
            # Question type
            if 'Math' in section[:50]:
                question['type'] = 'math'
            elif 'Brainstorming' in section[:50]:
                question['type'] = 'brainstorming'
            else:
                question['type'] = 'general'
            
            # Extract the actual question
            question_match = re.search(r':\s*(.+?)(?=\n\n|Math Solution|Notes to Interviewer|$)', section, re.DOTALL)
            if question_match:
                question['prompt'] = question_match.group(1).strip()
            
            # Extract solution/notes
            solution_match = re.search(r'(?:Math Solution|Notes to Interviewer):\s*(.+?)$', section, re.DOTALL)
            if solution_match:
                question['solution_notes'] = solution_match.group(1).strip()
            
            if question:
                questions.append(question)
        
        return questions
    
    def extract_exhibits(self, case_text: str) -> List[Dict]:
        """Extract data exhibits/tables"""
        exhibits = []
        
        # Find exhibit sections
        exhibit_sections = re.findall(
            r'Exhibit\s+\d+.*?(?=Exhibit\s+\d+|Question|Recommendation|$)', 
            case_text, 
            re.DOTALL
        )
        
        for idx, exhibit in enumerate(exhibit_sections):
            exhibits.append({
                'exhibit_number': idx + 1,
                'content': exhibit.strip()
            })
        
        return exhibits
    
    def extract_recommendation(self, case_text: str) -> Dict:
        """Extract the recommendation structure"""
        recommendation = {}
        
        # Find recommendation section
        rec_match = re.search(
            r'Recommendation:.*?(?=Bonus:|©|$)', 
            case_text, 
            re.DOTALL
        )
        
        if rec_match:
            rec_section = rec_match.group(0)
            
            # Extract recommendation points
            rec_points = re.search(r'Recommendation:\s*(.+?)(?=Risks:|Next Steps:|$)', rec_section, re.DOTALL)
            if rec_points:
                recommendation['recommendation'] = rec_points.group(1).strip()
            
            # Extract risks
            risks_match = re.search(r'Risks:\s*(.+?)(?=Next Steps:|$)', rec_section, re.DOTALL)
            if risks_match:
                recommendation['risks'] = risks_match.group(1).strip()
            
            # Extract next steps
            steps_match = re.search(r'Next Steps:\s*(.+?)(?=Bonus:|$)', rec_section, re.DOTALL)
            if steps_match:
                recommendation['next_steps'] = steps_match.group(1).strip()
        
        # Extract bonus tips
        bonus_match = re.search(r'Bonus:.*?\n(.+?)(?=©|$)', case_text, re.DOTALL)
        if bonus_match:
            recommendation['excellence_tips'] = bonus_match.group(1).strip()
        
        return recommendation
    
    def parse_case(self, case_text: str) -> Dict:
        """Parse a single case into structured JSON"""
        case_data = {
            'metadata': self.extract_case_metadata(case_text),
            'case_prompt': self.extract_case_prompt(case_text),
            'overview': self.extract_case_overview(case_text),
            'framework_guide': self.extract_framework_guide(case_text),
            'questions': self.extract_questions(case_text),
            'exhibits': self.extract_exhibits(case_text),
            'recommendation': self.extract_recommendation(case_text)
        }
        
        # Generate a unique ID for DynamoDB
        case_data['case_id'] = case_data['metadata'].get('title', '').lower().replace(' ', '_').replace("'", '')
        
        return case_data
    
    def split_cases(self) -> List[str]:
        """Split the full text into individual cases"""
        # Find where first Author: appears in practice cases section
        lines = self.full_text.split('\n')
        
        # Find "Practice Cases" section start
        practice_start_line = -1
        for i, line in enumerate(lines):
            if 'Practice Cases' in line and i > 1000:  # Should be towards end
                practice_start_line = i
                break
        
        if practice_start_line == -1:
            print("Could not find Practice Cases section")
            return []
        
        print(f"Found Practice Cases at line {practice_start_line}")
        
        # Find all "Author:" lines after this point
        case_starts = []
        for i in range(practice_start_line, len(lines)):
            line = lines[i].strip()
            if line.startswith('Author'):
                # Look back for title (non-empty, non-numeric line before Author)
                title = None
                for j in range(i-1, max(practice_start_line, i-10), -1):
                    potential_title = lines[j].strip()
                    if potential_title and not potential_title.isdigit() and len(potential_title) > 3:
                        # Avoid page numbers and other junk
                        if not re.match(r'^\d+$', potential_title) and not potential_title.startswith('©'):
                            title = potential_title
                            break
                
                if title:
                    case_starts.append({
                        'line_num': i,
                        'title': title
                    })
                    print(f"  Found case: {title} at line {i}")
        
        print(f"\nFound {len(case_starts)} cases total")
        
        # Split cases
        cases = []
        for i, start_info in enumerate(case_starts):
            start_line = start_info['line_num'] - 1  # Include title
            # Find where this case ends (start of next case or end of file)
            if i + 1 < len(case_starts):
                end_line = case_starts[i+1]['line_num'] - 1
            else:
                end_line = len(lines)
            
            case_lines = lines[start_line:end_line]
            case_text = '\n'.join(case_lines)
            
            if len(case_text.strip()) > 200:
                cases.append(case_text)
        
        return cases
    
    def parse_all_cases(self) -> List[Dict]:
        """Parse all cases in the document"""
        case_texts = self.split_cases()
        
        for case_text in case_texts:
            try:
                case_data = self.parse_case(case_text)
                # Only add if we extracted meaningful data
                if case_data['metadata'].get('title'):
                    self.cases.append(case_data)
            except Exception as e:
                print(f"Error parsing case: {str(e)[:100]}")
                continue
        
        return self.cases
    
    def save_to_json(self, output_path: str):
        """Save parsed cases to JSON file"""
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(self.cases, f, indent=2, ensure_ascii=False)
        
        print(f"Saved {len(self.cases)} cases to {output_path}")


# Example usage
if __name__ == "__main__":
    input_file = '2025_NYU_Stern_pdf_output.txt'
    output_file = 'PARSED_2025_NYU_Stern_pdf.txt'
    parser = CasebookParser(input_file)
    cases = parser.parse_all_cases()
    
    # Save to JSON
    parser.save_to_json(output_file)
    
    # Print summary
    print(f"\nParsed {len(cases)} cases:")
    for case in cases[:5]:  # Show first 5
        print(f"  - {case['metadata'].get('title', 'Unknown')}")
        print(f"    Industry: {case['overview'].get('industry', 'N/A')}")
        print(f"    Questions: {len(case['questions'])}")
        print()