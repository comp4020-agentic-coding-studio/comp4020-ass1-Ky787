# Assignment 1

## What was the breakthrough that moved the work forward?

Partitioning the work into various stages so as not to confuse claude with a complex site from the beginning. I first used a separate session to help compile the Hikari obfuscator, and run it on my test C file to generate all variants and finally to generate the dataset. Then I used it to help me write a first prompt and CLAUDE.md so I could steer the model in the correct direction instead of giving it all these different ideas all at once. Although this used all my usage on my personal account and most of claude's usage, I was able to fully generate 256 Windows binaries and use Capstone to extract the assembly from their main() which allowed the later steps to use real code instead of hallucinating it. 

## What did this work change about who I want to be as a software developer?

In the future I will be more cautious when sending prompts with highest thinking and model architecture in order not to max out my token usage. I was able to generate a correct and real web_data folder with my compiled assets and use part of the harness CLAUDE.md so that the agent used the real data without hallucinating what the assembly might be like if we were to generate a binary. 
