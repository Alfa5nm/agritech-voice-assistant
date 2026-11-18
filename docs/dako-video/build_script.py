from pathlib import Path
import json, re
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT=Path(__file__).resolve().parent
ART=ROOT/'assets/dako-storyboard.png'
OUT=ROOT/'Dako_Video_Script_and_Storyboard.docx'
doc=Document()
sec=doc.sections[0]
sec.page_width=Inches(8.27);sec.page_height=Inches(11.69)
sec.top_margin=Inches(.66);sec.bottom_margin=Inches(.65)
sec.left_margin=Inches(.75);sec.right_margin=Inches(.75)
sec.header_distance=Inches(.24);sec.footer_distance=Inches(.25)
WIDTH=6.77

def font(run,size=None,bold=None,color=None):
    bengali=bool(re.search(r'[\u0980-\u09ff]',run.text))
    name='Nirmala UI' if bengali else 'Calibri'
    run.font.name=name
    rf=run._element.get_or_add_rPr().get_or_add_rFonts()
    for key in ['ascii','hAnsi','eastAsia','cs']:rf.set(qn('w:'+key),name)
    if size:run.font.size=Pt(size)
    if bold is not None:run.bold=bold
    if color:run.font.color.rgb=RGBColor.from_string(color)
    if bengali:
        lang=OxmlElement('w:lang');lang.set(qn('w:val'),'bn-BD');lang.set(qn('w:bidi'),'bn-BD');run._element.rPr.append(lang)
    return run

for name in ['Normal','Body Text','Caption','Title','Subtitle','Heading 1','Heading 2','Heading 3']:
    style=doc.styles[name];style.font.name='Calibri';style.font.color.rgb=RGBColor(0,0,0)
    style.paragraph_format.space_after=Pt(7)
doc.styles['Normal'].font.size=Pt(10.8)
doc.styles['Normal'].paragraph_format.line_spacing=1.12
for name,size in [('Title',29),('Subtitle',12),('Heading 1',19),('Heading 2',13),('Heading 3',11.5)]:
    doc.styles[name].font.size=Pt(size)
    doc.styles[name].paragraph_format.space_before=Pt(11 if name!='Title' else 0)
    doc.styles[name].paragraph_format.space_after=Pt(7)
    doc.styles[name].paragraph_format.keep_with_next=True
for style in doc.styles:
    for node in list(style.element.iter(qn('w:pBdr'))):node.getparent().remove(node)
    if style.type==1:style.font.underline=False
doc.styles['Caption'].font.size=Pt(9)
doc.styles['Caption'].font.color.rgb=RGBColor.from_string('555555')

header=sec.header.paragraphs[0]
font(header.add_run('ডাকো'),12,True)
font(header.add_run('   /   VIDEO SCRIPT AND STORYBOARD'),8.5,color='000000')
footer=sec.footer.paragraphs[0];footer.alignment=WD_ALIGN_PARAGRAPH.RIGHT
font(footer.add_run('DAKO  •  AIBC TEAM COMPETITION  •  '),8,color='555555')
field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');footer._p.append(field)
doc.core_properties.title='Dako Video Pitch Script and Storyboard'
doc.core_properties.subject='Three minute production script with generated storyboard art'
doc.core_properties.author='Dako project team'
doc.core_properties.keywords='Dako, Bangla, agricultural support, telephone, storyboard'

def p(text='',bold=False,size=None,style=None,after=7):
    para=doc.add_paragraph(style=style)
    font(para.add_run(text),size,bold)
    para.paragraph_format.space_after=Pt(after)
    para.paragraph_format.widow_control=True
    return para

def h(text,level=1):
    para=doc.add_paragraph(style='Heading '+str(level));font(para.add_run(text),bold=True,color='000000');return para

def page(title,kicker=None):
    if kicker:
        first=p(kicker.upper(),size=8.5,after=4);first.paragraph_format.keep_with_next=True
        first.paragraph_format.page_break_before=True;h(title)
    else:h(title).paragraph_format.page_break_before=True

def label(title,text):
    para=doc.add_paragraph();font(para.add_run(title+'  '),bold=True);font(para.add_run(text));return para

def dialogue(who,bn,en=None):
    p(who.upper(),bold=True,size=9,after=2)
    p(bn,size=12.5,after=3)
    if en:p(en,size=9.5,after=7)

def table(headers,rows,widths):
    t=doc.add_table(rows=1,cols=len(headers));t.alignment=WD_TABLE_ALIGNMENT.CENTER;t.autofit=False
    for i,w in enumerate(widths):t.columns[i].width=Inches(w)
    for i,name in enumerate(headers):t.rows[0].cells[i].text=name
    for row in rows:
        cells=t.add_row().cells
        for i,text in enumerate(row):cells[i].text=str(text)
    for ri,row in enumerate(t.rows):
        props=row._tr.get_or_add_trPr();cant=OxmlElement('w:cantSplit');props.append(cant)
        if ri==0:
            repeat=OxmlElement('w:tblHeader');props.append(repeat)
        for ci,cell in enumerate(row.cells):
            cell.width=Inches(widths[ci]);cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
            pr=cell._tc.get_or_add_tcPr()
            borders=OxmlElement('w:tcBorders')
            for edge in ['top','left','bottom','right']:
                node=OxmlElement('w:'+edge);node.set(qn('w:val'),'single');node.set(qn('w:sz'),'5');node.set(qn('w:color'),'D9D9D9');borders.append(node)
            pr.append(borders)
            shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'303633' if ri==0 else ('F3F5F3' if ri%2 else 'FFFFFF'));pr.append(shade)
            margins=OxmlElement('w:tcMar')
            for edge in ['top','left','bottom','right']:
                node=OxmlElement('w:'+edge);node.set(qn('w:w'),'95');node.set(qn('w:type'),'dxa');margins.append(node)
            pr.append(margins)
            for para in cell.paragraphs:
                para.paragraph_format.space_after=Pt(2);para.paragraph_format.space_before=Pt(2);para.paragraph_format.line_spacing=1.06
                if ci==0:para.alignment=WD_ALIGN_PARAGRAPH.CENTER
                for run in para.runs:font(run,9.5,ri==0,'FFFFFF' if ri==0 else '000000')
    p('',after=2)
    return t

def picture(row,col=None,width=WIDTH,caption=''):
    para=doc.add_paragraph();para.paragraph_format.space_after=Pt(3);para.paragraph_format.keep_with_next=True
    height=width*(9/16 if col is not None else 9/32)
    shape=para.add_run().add_picture(str(ART),width=Inches(width),height=Inches(height))
    crop=OxmlElement('a:srcRect')
    crop.set('t',str(row*25000+150));crop.set('b',str((3-row)*25000+150))
    crop.set('l',str((col*50000+150) if col is not None else 150));crop.set('r',str(((1-col)*50000+150) if col is not None else 150))
    blip=shape._inline.xpath('.//pic:blipFill')[0];blip.insert(1,crop)
    shape._inline.docPr.set('descr','AI generated conceptual storyboard illustration for '+caption)
    shape._inline.docPr.set('title',caption)
    p(caption+'  |  AI-generated storyboard concept; replace with real footage or screen capture in the film.',style='Caption',after=9)

title=doc.add_paragraph(style='Title');font(title.add_run('Dako video pitch script'),29,True,'000000')
p('Production script and illustrated storyboard',style='Subtitle')
p('AIBC team competition  •  180 seconds  •  Version 1  •  19 November 2026',size=9,after=14)
picture(0,0,caption='Opening frame  A season of work')
p('A season of work.\nOne unanswered question.',bold=True,size=25,after=12)
p('A farmer can describe what is happening in the field. Dako is being built to help them reach understandable support through an ordinary telephone call, without navigating an app or searching the internet themselves.')
p('This book contains the timed pitch, recording dialogue, eight illustrated storyboard frames, filming directions, demo alternatives, evidence boundaries and a final production checklist. English narration carries the judging argument; actual Bangla call audio carries the demonstration.')
p('সাহায্য দরকার? ডাকো।',bold=True,size=22,after=3)
p('Need help? Dako.',size=11)

page('The film and the judging argument','Creative brief')
h('The central story',2)
p('Follow one fictional rice farmer who notices yellowing leaves and asks, “What should I do now?” The camera stays with that farmer and the same phone. As the conversation proceeds, the operator view reveals how words become proposed details, corrected information and a structured support case. Return to the farmer at the end; resolve the access problem without claiming that the film has saved a harvest.')
p('The opening earns attention through a concrete decision. The demonstration earns trust through visible behaviour. The closing gives the audience a short phrase they can repeat: “সাহায্য দরকার? ডাকো।”')
h('Who the film represents',2)
p('Some callers cannot comfortably read an interface; others can read but lack digital skills, reliable mobile data, suitable devices or confidence evaluating online information. These are different barriers. Show an experienced farmer whose knowledge is valuable and whose access to additional information is limited. Do not portray rural people as incapable, or claim that most farmers are illiterate without evidence.')
table(['Window','Required segment','Purpose'],[
('00:00–00:30','Problem','Establish the farmer, the decision and the access barrier.'),('00:30–01:00','Solution','Show a familiar phone becoming the route to support.'),('01:00–02:00','Demo or flow','Prove the current workflow with real clips or an honestly labelled walkthrough.'),('02:00–02:30','AI approach','Explain voice, confirmation, records and reviewed retrieval.'),('02:30–03:00','Impact and next step','Present the sponsor model, pilot measures, roadmap and recall.')],[1.12,1.33,4.32])
h('Visual and sound direction',2)
p('Use documentary-style field footage with a minimal operator interface. Rice green is the main accent; muted red and warm yellow appear in the voice orb and graphics. Keep Bangla and English subtitles readable. Hold the first spoken line in near silence. Use a restrained music bed during explanation, and duck it completely for important phone audio.')
p('The farmer needs voice-network coverage. The backend needs internet connectivity. Calling costs and carrier compatibility must be measured; the film must not promise fully offline service, free calls, perfect dialect handling or zero waiting.')
h('The differences to make visible',2)
p('Familiar access: an ordinary call. Guided intake: the farmer can begin with an observation rather than a technical term. Audible verification: important details are read back and corrected. Continuity: consented, verified context can support later conversations. Evidence boundaries: the system can identify missing information instead of improvising a prescription. These are the design advantages to demonstrate; they are not a claim that no competing service offers them.')

page('The master recording script','Read this section for the final spoken sequence')
p('Primary version: English narration with actual Bangla demo excerpts. Record approximately 135–145 English words per minute, then time the real takes. Stage directions and labels below are not spoken. The next page contains the final minute and the alternative demo wording.',size=10)
h('Opening and problem',2)
label('00:00–00:06','Black to an intimate leaf-and-phone shot. One button sound. No music.')
dialogue('Farmer','ভাই, ধানের পাতাগুলো হলুদ হয়ে যাচ্ছে। এখন আমি কী করব?','The rice leaves are turning yellow. What should I do now?')
label('00:06–00:30  Narrator','For a farmer, that question can decide what happens to a season’s work. Useful information may already exist online. Reaching it can require reading unfamiliar text, searching for the right terms, or navigating a smartphone. Owning a phone does not automatically make that knowledge accessible.')
p('On screen: “A season of work. One unanswered question.” Keep the farmer’s uncertainty visible without melodrama. Label an acted scene “Illustrative scenario.”',size=9.5)
h('Solution',2)
label('00:30–01:00  Narrator','Dako brings agricultural support into an ordinary phone conversation. A farmer speaks in their own words. The assistant asks permission, confirms important details, and narrows the problem one question at a time. Our goal is a personal agricultural helper that remembers verified context and makes useful information understandable over a call.')
p('On screen: “Speak the question. Start the support.” Show the farmer’s telephone separately from the operator UI. Small caption: “Voice-network coverage required; service backend uses internet.”',size=9.5)
h('Demonstration',2)
label('01:00–01:06  Narrator','Here is the prototype. The farmer’s interface is the call; this screen is the operator’s view.')
label('01:06–01:21  Call audio','Use genuine Salam, AI identification and storage-consent excerpts. Show fictional test details and label the recording accordingly. Keep the full consent and read-back sequence in the source recording even when only excerpts appear in the edit.')
label('01:21–01:35  Correction','Play a real scripted correction: মহেশপুর → মহাদেবপুর → caller agreement. Then narrate: “Corrections remain proposals until the caller confirms them.”')
dialogue('01:35–01:48  Caller and assistant','ধানের পাতা হলুদ হয়ে গেছে।\nপুরো পাতা হলুদ, নাকি শুধু ডগা বা কিনারা?','The rice leaves have turned yellow. / Is the whole leaf yellow, or only the tips or edges?')
label('01:48–02:00  Narrator','The next step depends on the case and the evidence available. Missing or unclear information calls for another question or specialist support.')

page('The final minute and the fallback cut','Master script continued')
h('AI approach',2)
label('02:00–02:30  Narrator','Gemini Live handles the voice conversation. Backend tools manage confirmed facts, encrypted profiles and retrieval eligibility. Our retrieval framework is built; specialist-reviewed rice content is still being prepared. We are testing safeguards for unclear speech, background noise and uncertain confirmation, so a fluent answer is never treated as evidence of a saved fact.')
p('Reveal the architecture gradually: ordinary phone → live Bangla voice → confirmation tools → encrypted case → reviewed retrieval. Show proposed and confirmed records as different states. Do not animate a source arriving unless a real retrieval result exists.',size=10)
h('Impact and next step',2)
label('02:30–02:50  Narrator','Next, we plan to connect weather, crop-market information and local growing guidance. Cooperatives, NGOs or extension programmes could sponsor access. A supervised pilot will measure useful-case completion, farmer understanding, response time and cost. We start with rice; the wider vision is personal support through voice.')
label('02:50–02:56  Narrator','A season of work deserves an answer the farmer can use.')
dialogue('02:56–03:00  Final voice','সাহায্য দরকার? ডাকো।','Need help? Dako.')
p('End card: ডাকো / DAKO. Keep the closing phrase central and legible. Do not add a feature list. Put real team names and roles in a small lower line that remains within the safe area. Rehearse the final 30 seconds together; tighten narration before shortening the closing.',size=10)
h('Use this if the phone registration demo remains unreliable',2)
p('Replace the success-dependent portion of 01:00–02:00 with the following narration and genuine component evidence. Label it “Prototype and workflow walkthrough.” This is permitted by the preliminary guide; it must not look like a single successful end-to-end run.')
p('“Here is our telephone prototype, using fictional test details. The voice call is working. The registration workflow collects permission, details, read-back and confirmation before an encrypted profile can be saved. That complete phone-to-registration journey is still under validation. Our rice intake begins with observations and asks focused follow-up questions. When the necessary evidence is missing, the next step is clarification or specialist support.”')
p('Use the remaining time for real phone audio, the actual pending/confirmed UI and labelled backend tests. Never replace failed saves with invented green ticks, fabricated records or a reconstructed success screen.',size=10)
h('Timing discipline',2)
p('The five segment boundaries remain 00:30, 01:00, 02:00, 02:30 and 03:00. Leave narration space around the call. Shorten explanation before compressing dialogue. If pauses are removed, display “Pauses shortened.” An elapsed-time counter must reflect the recording; do not leave it running across hidden cuts.')

scenes=[
 dict(title='The question and the access barrier',row=0,kicker='Storyboard frames 01 and 02  •  00:00 to 00:30',
 a=('Frame 01  The season in one question','00:00–00:12','Extreme close-up of a hand and a yellowing rice leaf; then a shoulder or partial face. Use early, soft light and a shallow background. The farmer looks attentive, not helpless. The crop observation must remain visually ambiguous.',
 'Hear the farmer’s first question before explaining the product. Hold the leaf for a beat as “A season of work. One unanswered question.” appears. Begin the narrator after the question has landed.',
 'Start from black with field sound. Cut on the word “now” to the farmer’s phone. Keep the music absent until the narration begins.'),
 b=('Frame 02  Ownership is not usable access','00:12–00:30','A medium shot at a simple veranda table. The farmer attempts an unfamiliar smartphone interface; the keypad phone sits within reach. A team-made generic screen is enough. Do not display an actual person’s account, private messages or an identifiable competing product.',
 'Narration names reading, search terms and app navigation as possible barriers. Show the farmer pausing to think rather than fumbling theatrically. The ordinary phone is already part of their everyday life.',
 'A soft interface tap can punctuate the search insert. Keep it brief. Match the farmer’s hand position into the next close-up of the keypad phone.')),
 dict(title='The call and the first conversation',row=1,kicker='Storyboard frames 03 and 04  •  00:30 to 01:21',
 a=('Frame 03  The familiar action','00:30–01:00','Tight close-up of the same physical phone and the call button. Capture a real outgoing call if the route has been verified. Let the fingers and the ordinary keypad do the storytelling. Keep graphics outside the phone display.',
 'Introduce Dako and explain the conversational support model. A thin graphic connection may lead from the telephone to the operator view. It is an explanatory overlay, not software the farmer must install.',
 'Introduce the Dako wordmark after the call button. Use one restrained green-red-yellow sweep. Include the network-coverage qualification without interrupting narration.'),
 b=('Frame 04  Trust begins with permission','01:00–01:21','Medium portrait of the farmer listening to the phone at their ear. Keep continuity in clothing, phone and location. The phone recording must identify the system as AI and request service/storage consent.',
 'Use the actual greeting beginning with আসসালামু আলাইকুম. Show the AI listening and the farmer responding naturally. Use fictional information; a real participant’s consent to filming and audio recording is separate from service consent.',
 'Cut to the operator screen only after the narrator explains whose interface it is. Music drops out for the greeting. All Bangla audio receives accurate English subtitles.')),
 dict(title='The correction and the useful question',row=2,kicker='Storyboard frames 05 and 06  •  01:21 to 02:00',
 a=('Frame 05  Make correction visible','01:21–01:35','A phone on the table and the real laptop operator view. Use the artwork only for shot planning. In the final film, capture the actual transcript, proposal and confirmed-state changes. Mask the test number.',
 'The caller corrects the location from মহেশপুর to মহাদেবপুর. Keep that correction in the source recording. Show the new proposal and a later confirmation only if the backend accepts them. Narrate the short explanation after the important exchange.',
 'Record a clean screen capture separately from the camera view, then align both using an audible clap before the test. Never draw a success state over a failed request. A shortened pause needs a visible label.'),
 b=('Frame 06  Narrow the rice problem','01:35–02:00','Over the farmer’s shoulder, inspect a plant while the telephone remains visible. Show where the yellowing appears without selecting a disease or depicting a chemical treatment. The shot should make the follow-up question feel useful.',
 'Play the genuine crop complaint and a focused clarification about leaf tips, edges or the whole leaf. Then explain that evidence and missing context determine the next step. If no reviewed evidence exists, show the real availability boundary.',
 'A gentle camera move follows the hand toward the leaf tip. Remove music for the question. Return to a wider view before transitioning to the architecture, keeping the human problem present.')),
 dict(title='The system and the closing recall',row=3,kicker='Storyboard frames 07 and 08  •  02:00 to 03:00',
 a=('Frame 07  Explain what owns the decision','02:00–02:30','Use the diagram concept as a visual reference, then build an editable five-block graphic. Show voice input, backend confirmation, encrypted records and reviewed retrieval. Distinguish stored case facts from model output.',
 'Explain the architecture in plain language. Identify the rice corpus as being prepared. Show safeguards as work under validation rather than claiming that coughing, dialects or hallucinations have been solved perfectly.',
 'Reveal one block with each relevant phrase. Keep only short labels on screen. Avoid brain animations, decorative code and invented reasoning streams. The source of each visible event must be real or labelled conceptual.'),
 b=('Frame 08  The phone returns','02:30–03:00','Return to the same farmer and phone in warm late-afternoon light. The farmer is composed because a support process has begun; do not imply an overnight crop recovery. Reserve clean space beside the subject for the wordmark.',
 'Show planned weather, market and growing-guidance cards during the roadmap narration, then remove them. At 02:50, return fully to the farmer. End with “সাহায্য দরকার? ডাকো।” Speak it with warmth and a firm, unhurried final word.',
 'Hold the Dako wordmark and closing phrase through the last beat. Fade the music after the final word, not before it. Keep the end card still; do not crowd it with QR animation or more features.')),
]

for scene in scenes:
    page(scene['title'],scene['kicker'])
    picture(scene['row'],caption=f"Frames {scene['row']*2+1:02d} and {scene['row']*2+2:02d}")
    for key in ['a','b']:
        title,when,visual,action,edit=scene[key]
        h(title,2);p(when,bold=True,size=9,after=4)
        label('Picture',visual);label('Performance and proof',action);label('Sound and edit',edit)

page('The full registration recording sheet','Actor and operator rehearsal reference')
p('Record the full sequence first, then choose truthful excerpts for the 60-second demo. These are target beats, not a transcript to dub over model output. The backend may add read-back turns. Keep the phone number to a team-approved test line and mask it in the published screen recording.',size=10)
dialogue('Assistant opening','আসসালামু আলাইকুম। আমি ডাকো, কৃষি সহায়তার একটি এআই সহকারী।','Assalamu alaikum. I am Dako, an AI agricultural support assistant.')
dialogue('Assistant asks permission','আপনার নাম, এলাকা আর ফোন নম্বর এই সেবার জন্য সংরক্ষণ করতে পারি?','May we store your name, area and phone number for this service?')
dialogue('Caller','জি, রাখতে পারেন।','Yes, you may.')
dialogue('Assistant reads back consent','আপনি তথ্য সংরক্ষণে সম্মতি দিয়েছেন—ঠিক বুঝেছি?','You have agreed to storing these details. Have I understood correctly?')
dialogue('Caller confirms','জি, ঠিক বুঝেছেন।','Yes, that is correct.')
dialogue('Name exchange','আপনাকে কী নামে ডাকব?\nকরিম।\nআপনার নাম করিম, ঠিক তো?\nজি, ঠিক আছে।','What should I call you? / Karim. / Your name is Karim, correct? / Yes, that is right.')
dialogue('Location and correction','আপনি কোন এলাকায় থাকেন?\nমহেশপুর।\nআপনার এলাকা মহেশপুর, ঠিক তো?\nনা, মহাদেবপুর হবে।\nমহাদেবপুর, ঠিক বললাম?\nজি, এবার ঠিক আছে।','Which area do you live in? / Maheshpur. / Is that correct? / No, Mahadevpur. / Mahadevpur, correct? / Yes, that is right now.')
label('Phone recording','The caller states the team-approved test number. The assistant reads every digit back, waits for playback and asks whether it is correct. Use a natural reply, including a correction if needed. Do not publish another person’s number or assume that a phone number proves identity.')
label('Completion','Show registration saved only after the backend accepts all required confirmed fields. Age remains optional. If the voice model uses different wording, subtitle its real wording. Do not dub the target dialogue into a failed call.')

page('Unclear speech and evidence boundaries','Failure cases to record honestly')
h('A short noise or cough',2)
p('Capture a controlled cough or background-noise test only with participant agreement. The desired behaviour is to avoid using the sound as a fact or confirmation. If speech is genuinely unclear, a short Bangla clarification is appropriate. Test results must be described as observed behaviour, not proof of reliable cough detection in every environment.')
dialogue('Clarification target','শেষ কথাটা পরিষ্কার শুনতে পাইনি। তথ্যগুলো ঠিক আছে, নাকি কিছু বদলাতে হবে?','I did not hear the last part clearly. Are the details correct, or does something need changing?')
h('A natural correction',2)
dialogue('Caller','নাম ঠিক আছে, কিন্তু নম্বরটা ভুল।','The name is correct, but the number is wrong.')
p('Keep the batch unconfirmed. Ask for the corrected number, propose it, read it back and wait for a later reply. This is a stronger demonstration than accepting a fixed keyword because it shows that the whole answer matters.')
h('A delayed or missing response',2)
p('The current guardrail design uses a four-second wait indication and a twelve-second bound for a missing AI reply. Contextual confirmation has a three-second bound. During registration, a caller who gives no clear reply gets one gentle reminder after twenty seconds; prolonged absence stops AI voice while preserving the phone call. These are implementation settings under live validation, not a service-level guarantee.')
p('Film the actual response behaviour if it works. If a timeout or noise test fails, keep it in the development evidence and use the honest walkthrough cut in the pitch. Never hide a stall behind a continuously running “live” timer.')
h('When agricultural evidence is missing',2)
p('The system must not diagnose yellowing from one observation or invent a fertilizer recommendation. Show the next clarification and the actual evidence status. A request for specialist support is not a confirmed appointment, and the prototype does not automatically send SMS.')
h('How future capabilities appear',2)
table(['Capability','Film status','What must precede a service claim'],[
('Weather context','Planned','A current source, approximate location, date and local interpretation.'),('Crop market reports','Planned','Verified market, commodity, unit, source and timestamp.'),('Crop planning','Planned','Region, season, soil/context intake and specialist-reviewed guidance.'),('Emergency or public-service intake','Longer-term vision','Verified institutional routing and separate domain validation.')],[1.37,1.0,4.40])

page('Architecture commercial logic and measures','The explanation behind the pitch')
h('The operating architecture',2)
p('Alaap carries the telephone call. Gemini Live on Vertex provides speech interaction. Backend tools validate source turns, proposals, delivered read-back and confirmation. Supabase holds encrypted case/profile data and the retrieval framework. The operator workspace exposes real state; the farmer does not need it. The working prototype may still show the earlier Agritech label; align public branding before recording or identify it as the working prototype without altering evidence.')
h('Trust and data handling',2)
p('Ask permission before storing profile data and obtain separate recording permission before filming. A shared number does not identify which person is speaking. Previous-profile access needs independent verification. Cloud processing must be disclosed; encryption is not proof of Bangladesh-only data residency. Display genuine source provenance and approval status, and mask personal details in the film.')
h('A proposed route to sustainable access',2)
p('A cooperative, NGO, extension programme or telephone partner could sponsor the service and its call costs. Present a paid pilot or service contract as a proposed model, not signed revenue. Measure operating cost before promising a free farmer experience. Agricultural guidance should not be shaped by incentives to sell a particular input.')
table(['Pilot measure','What to record'],[
('Useful-case completion','The proportion of consented calls that reach an accurate confirmed case and a clearly communicated next step.'),('Understanding','Whether the caller can explain the agreed next step in their own words.'),('Reliability and delay','Registration success, correction accuracy, script drift, noise rejection and median / slow-case reply delay.'),('Cost and access','Cost per useful completed case; call charges; completion across tested devices and carrier routes.'),('Longer-term benefit','Field evidence before claims about yield, income, input savings or avoided crop loss.')],[1.55,5.22])
h('Why the solution can travel',2)
p('The reusable pattern is voice intake, clarified context and a governed support pathway. Start with a supervised Bangladesh rice pilot. Expansion needs local vocabulary, suitable sources and human domain review for each region or service. Public-service navigation and disaster-preparedness information are plausible later uses; do not position the prototype as a replacement for emergency responders.')

page('Production edit and submission checks','Director and editor reference')
h('Record the proof before locking the edit',2)
p('Assign a farmer actor, narrator/presenter, operator and camera/editor. Team members may cover several roles. Record field inserts and a physical feature-phone test if claiming feature-phone compatibility. Capture laptop screens directly. Use one audible synchronization clap before the call test and keep an untouched source recording.')
h('Make the dialogue easy to follow',2)
p('Use 1920 × 1080, 16:9, at 25 or 30 fps as production defaults. Keep essential material inside the central safe area. At 1080p, aim for approximately 36–44 px subtitles and inspect at ordinary viewing size. Use Noto Sans Bengali or another verified Bangla font. Place English subtitles over a restrained dark backing with no more than two lines at a time. Do not speed up the farmer’s speech.')
h('Finish the recall',2)
p('At 02:50, remove roadmap cards and return to the original farmer and phone. The narrator completes the season-of-work thought. At 02:56, deliver “সাহায্য দরকার? ডাকো।” with a short pause before ডাকো. Hold the wordmark. Keep a small team credit line, but no new claims or feature list. The closing must land before 03:00.')
table(['Official component','What the film should demonstrate'],[
('Innovation and AI Native Design  20','Familiar telephone access combined with conversational intake and confirmed context.'),('Technical Excellence and Architecture  20','A clear voice-to-backend flow, real tool activity, evidence boundaries and tested failure handling.'),('Business Value and Commercial Viability  20','A prospective sponsor, a practical pilot and measured cost per useful completed case.'),('Global Scalability and Real World Impact  20','A focused local starting point with a credible localization and expansion path.'),('Responsible AI Data Sovereignty and Presentation  20','Consent, corrections, shared-phone identity controls, processing disclosure and honest footage.')],[2.55,4.22])
p('Source: supplied AIBC Participants Guide, sections 9.1, 9.2, 11.1 and 15. The preliminary pitch permits an early prototype, mock flow or walkthrough. Do not substitute the Single Prompt Challenge rubric. No exact score or advancement outcome is promised.',size=9.5)
p('Final watch-through: confirm an exact 180-second export; accurate subtitles; planned-feature labels; no visible credentials; truthful saved-state footage; intelligible audio; and a strong, unobstructed closing. Trademark and domain availability for Dako remain unchecked.',size=9.5)

page('Storyboard artwork direction','Asset provenance and reproducibility')
p('The eight storyboard frames are original AI-generated concept art produced with the built-in ImageGen tool. They are planning illustrations, not real farmer photographs, a product screenshot, user research or proof of feature performance. The final contact sheet is embedded directly in this DOCX; individual views use document-level cropping, not external image links.')
p('Final source asset: assets/dako-storyboard.png. Keep it with the editable production materials. The following generation and edit prompts record the art direction used. Real filming can adapt the composition to location, actor consent, lighting and the actual device.')
h('Generation prompt',2)
p('Use case: illustration-story. Asset type: eight-frame cinematic storyboard contact sheet for the Word production script of DAKO, a Bangla agricultural telephone assistant. Create ONE high-resolution storyboard sheet, portrait overall aspect ratio 8:9, EXACTLY TWO COLUMNS and FOUR ROWS, eight equally sized edge-to-edge 16:9 storyboard frames, divided only by very thin straight ivory rules. NO text, labels, numbers, typography, logos, watermarks, speech bubbles or UI words anywhere. Hand-drawn professional film storyboard: fine graphite and charcoal ink linework, soft wash shadows, restrained rice green, warm yellow and tiny muted red accents on off-white paper. Grounded, dignified rural Bangladesh, not caricatured poverty; small rice plots, practical clothing, authentic simple tools. Maintain the SAME fictional Bangladeshi farmer aged around 45 in pale cream shirt and green checked lungi and the SAME small black physical numeric-keypad feature phone in every applicable shot. Ordered frames, reading left to right then next row: 1 extreme close-up a farmer\'s hand holding a rice leaf with some yellowing, season\'s work behind him, intimate dawn light; 2 medium shot this thoughtful farmer at a modest veranda table holding a smartphone with a small confusing unreadable interface, a keypad phone beside his hand, no distress caricature; 3 tight close-up thumb pressing the call button of the black keypad phone, farmer\'s rice field reflected in worn screen; 4 medium portrait farmer listening carefully to the keypad phone held to his ear, shoulders relaxed, field background;',size=10)

page('Storyboard artwork direction continued','Final scenes and targeted correction')
p('5 split spatial composition within the frame: foreground phone on simple table on active call, background laptop with a minimal dark charcoal operator interface with a green-red-yellow circular voice orb and unlabelled stacked profile lines; no legible text and no invented charts; 6 over-shoulder farmer looks closely at rice plant while speaking into keypad phone, inspecting where yellowing appears without diagnosing it, calm daylight; 7 editorial concept frame: simple telephone at left connected through a luminous green/yellow voice circle to plain unlabelled rectangular case cards and source documents, grounded sketch aesthetic, no brain imagery, no fake text; 8 closing wide-medium shot same farmer on ear-level phone at field edge in warm late-afternoon light, composed and quietly reassured, open negative space on right for Dako closing typography to be added separately. Avoid treatments, chemicals, miracle harvest transformations, emergency ambulances, cash growth charts, or claims of actual users. Storyboard art is conceptual, not photographic evidence. Ensure eight frames and exact regular grid geometry.',size=10)
h('Targeted edit prompt',2)
p('Precise edit to this eight-frame storyboard contact sheet. Preserve the exact two-column four-row grid, overall dimensions, farmer identity, illustration style, colour palette, framing and all other objects and scenes. Change only frames 5 and 7 (row 3 left, row 4 left). In BOTH of these frames, the physical numeric-keypad phone must have a simple dull monochrome ordinary telephone-call display with no app, no coloured orb, no animation, no graphic interface and no readable words. The farmer needs no application. In frame 5 also remove the woman with headset and her body; leave the laptop on the desk by itself, clearly an operator-view monitoring screen, retaining the laptop\'s dark interface and circular green-yellow-red voice orb. Keep frame 7\'s separate conceptual voice orb and context cards exactly as they are, only simplifying the phone display. Do not modify the other six frames. No additional text, labels, logos or watermark.',size=10)
h('What is still to produce',2)
p('This deliverable is a Word production script with embedded concept artwork. It does not include a rendered video, voiceover, rights-cleared field footage, a validated feature-phone registration recording, reviewed agricultural advice or measured farmer outcomes. Collect those items before claiming them in the final film.')
p('সাহায্য দরকার? ডাকো।',bold=True,size=21)

for node in list(doc.element.iter(qn('w:pBdr'))):node.getparent().remove(node)
doc.save(OUT)
print(json.dumps({'output':str(OUT),'paragraphs':len(doc.paragraphs),'tables':len(doc.tables),'embedded_drawings':len(doc.inline_shapes),'planned_pages':14},ensure_ascii=False))
