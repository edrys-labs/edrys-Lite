<script lang="ts">

    export default {
    name: "Logger",


    data() {
        return {
        
        };
    },
    
    methods: {
        
    },
    };
</script>

<template>
    <v-card>
        <v-toolbar dark flat>
            <v-toolbar-title>Logger</v-toolbar-title>

            <v-spacer></v-spacer>

            <v-btn icon @click="$emit('close')">
                <v-icon>mdi-close</v-icon>
            </v-btn>
        </v-toolbar>
    </v-card>
</template>