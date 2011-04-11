'''Project Dex
Simplistic multiplayer card-like RPG.
'''
DEBUG = True
import random

class Ability(object):
    '''Base Ability class. Abilities are the one special ability that each hero
    has in addition to Attack and Defend. These general expend MP and add
    interesting effects to the game. During battle the method `Ability.affect`
    will be called on a specific target.'''
    description = "A detailed description of what the ability does"
    cost = 1
    def affect(self, target):
        '''Empty effect method, it's up to the '''
        raise NotImplementedError(repr(self) + repr(target))
    def __repr__(self):
        return self.__class__.__name__ + "(" + str(self.cost) + ")"

class Heal(Ability):
    '''A simple heal ability for testing purposes.'''
    description = "Use primitive medical skills"
    cost = 2
    def affect(self, target):
        '''Raise targets HP by (1,5)'''
        target.h_p += random.randint(1, 5)

class Roar(Ability):
    '''A simple status effect ability for testing.'''
    description = "Strike fear in the hearts of foes"
    def affect(self, target):
        '''Reduce targets defense by 1'''
        target.defense -= 1
    
class Hero(object):
    '''Base battle piece class'''
    h_p = 1
    m_p = 1
    defense = 1
    strength = 1
    agility = 1
    ability = Ability()
    def __init__(self, name):
        self.name = name
    def attack(self, target):
        '''Use primitive physical force to hurt or maim one's target. If the
        target has defendors, we subtract the target's defense pool from our
        attack. We subtract the remaining damage from our target's HP pool.
        The damage dealt is returned.'''
        dmg = self.strength
        if target.defendors:
            dmg -= target.defense
            target.defendors.pop()
        if dmg > 0.0:
            target.h_p -= dmg
        return dmg
    def defend(self, target):
        '''Add this Hero to the target's defense team. While on defense we
        use the team's pooled defense stat. After each physical attack a
        `random` defendor is removed.'''
        target.defendors.append(self)
    def __repr__(self):
        return self.name + " the " + self.__class__.__name__

class WeakMage(Hero):
    '''A sample mage class hero'''
    agility = 2
    m_p = 2
    ability = Heal()
    def __init__(self, name = "Medic!"):
        Hero.__init__(self, name)

class WeakFighter(Hero):
    '''A sample fighting class hero'''
    ability = Roar()
    def __init__(self, name = "Brave"):
        Hero.__init__(self, name)

class Team(object):
    '''This is the battle team object, it holds the hp, mp, and defense pools.
    '''
    h_p = 0
    m_p = 0
    defense = 0
    def __init__(self, name, players):
        self.name = name
        self.players = players
        for player in players:
            self.h_p += player.h_p
            self.m_p += player.strength
            self.defense += player.defense
        self.defendors = []
    def reset(self):
        '''Generally called at the end or beginning of each round. Resets
        various states that are in the scope of a round, such as the heroes
        that are defending.'''
        self.defendors = []
        
def end_game(teams):
    '''Tests all teams for the simple end game scenario where at least one
    team's HP pool is less than 1'''
    for team in teams:
        if team.h_p < 1:
            return True
    return False

def get_user_choice(hero, team, teams):
    '''Gets user input for a specific hero on a team this round'''
    choice = 0
    target = 0
    choices = [1, 2, 3]
    if hero.ability.cost > team.m_p:
        choices.pop()
    while choice not in choices:
        print team.name, "(", team.h_p, ") - ", hero.name
        print "1) Attack"
        print "2) Defend"
        if 3 in choices:
            print "3) ", hero.ability
        choice = input("Action? ")
    if choice == 2:
        hero.defend(team)
    else:
        while target not in range(1, len(teams)+1):
            target = input("Target (1 red, 2 blu)")
    if choice == 1:
        return (hero.agility, hero.attack, teams[target-1])
    elif choice == 3:
        team.m_p -= hero.ability.cost
        return (hero.agility, hero.ability.affect, teams[target-1])

def battle(teams):
    '''A simple battle simulation'''
    while not end_game(teams):
        tasks = []
        for team in teams:
            for hero in team.players:
                tasks.append(get_user_choice(hero, team, teams))
        tasks.sort()
        for task in tasks:
            print task[1], task[2]
            task[1].__call__(task[2])
        for team in teams:
            team.reset()
    standings = [(team.h_p, team.name) for team in teams]
    standings.sort()
    standings.reverse()
    return standings

def print_game_end(results):
    '''Prints out a friendly representation of the battle results'''
    print "The game has ended our winner is ", results[0][1]
    print "With a lead of ", results[0][0]-results[1][0], " over ", 
    print results[1][1]
    
if __name__ == '__main__':
    TEAMS = [Team("Red", [WeakMage()]), Team("Blu", [WeakFighter()])]
    RESULTS = battle(TEAMS)
    print_game_end(RESULTS)
